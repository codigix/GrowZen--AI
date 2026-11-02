"""Featured images for blog articles: any common upload becomes one optimized WebP.

Accepted: JPG/JPEG, PNG, WebP, GIF (first frame), BMP, TIFF, AVIF, HEIC/HEIF, SVG and PDF (one chosen page).
The format is detected from the file's bytes and must agree with the file extension; nothing the file claims about
itself is trusted. Raster images are decoded by Pillow (with a pixel limit against decompression bombs), HEIC/HEIF by
pillow-heif, and PDF pages and SVGs are rendered to pixels by PyMuPDF: no scripts, forms or links in them are run,
and SVGs with scripts, event handlers, external references or entity declarations are refused outright.

The result: at most 1200 px on its longest side (aspect ratio kept, never upscaled), transparency kept where the
source has it, WebP quality 82. A WebP upload that is already small enough is kept as it is when re-encoding would
not make it smaller. Publishing to WordPress uploads this WebP once to the media library (POST /wp-json/wp/v2/media),
sets its ALT text, and the post points at it through `featured_media`.
"""
import base64
import hashlib
import io
import re
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

UPLOAD_ROOT = Path(__file__).resolve().parents[2] / "uploads"
MAX_INPUT_BYTES = 15 * 1024 * 1024  # the file as uploaded (PDF/TIFF/HEIC originals can be large)
MAX_SVG_BYTES = 2 * 1024 * 1024
MIN_BYTES = 64
MAX_PIXELS = 60_000_000  # 60 MP: larger images are refused (decompression-bomb guard)
MAX_PDF_PAGES = 500
TARGET_MAX = 1200  # longest side of the stored WebP (1200 x 630 recommended for blog cards)
WEBP_QUALITY = 82
TYPES = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}
LABEL = {"jpg": "JPEG", "png": "PNG", "webp": "WebP", "gif": "GIF", "bmp": "BMP", "tiff": "TIFF", "avif": "AVIF",
         "heif": "HEIC/HEIF", "svg": "SVG", "pdf": "PDF"}
EXTENSIONS = {"jpg": "jpg", "jpeg": "jpg", "jfif": "jpg", "png": "png", "webp": "webp", "gif": "gif", "bmp": "bmp", "dib": "bmp",
              "tif": "tiff", "tiff": "tiff", "avif": "avif", "heic": "heif", "heif": "heif", "hif": "heif", "svg": "svg", "pdf": "pdf"}
SUPPORTED_TEXT = "JPG, JPEG, PNG, WebP, GIF, BMP, TIFF, AVIF, HEIC/HEIF, SVG or PDF"

Image.MAX_IMAGE_PIXELS = MAX_PIXELS  # Pillow raises DecompressionBombError beyond 2x this, warns beyond it


class ImageError(ValueError):
    pass


# ── detection ───────────────────────────────────────────────────────────────────

def sniff(data: bytes) -> str | None:
    """The real format from the file's bytes."""
    head = data[:64]
    if head[:3] == b"\xff\xd8\xff":
        return "jpg"
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if head[:2] == b"BM" and len(data) > 26:
        return "bmp"
    if head[:4] in (b"II*\x00", b"MM\x00*", b"II+\x00", b"MM\x00+"):
        return "tiff"
    if head[:5] == b"%PDF-" or b"%PDF-" in data[:1024]:
        return "pdf"
    if head[4:8] == b"ftyp":
        brands = {head[8:12]} | {head[i:i + 4] for i in range(16, min(len(head), 40), 4)}
        if brands & {b"avif", b"avis"}:
            return "avif"
        if brands & {b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"mif1", b"msf1"}:
            return "heif"
    text = data[:2048].lstrip(b"\xef\xbb\xbf \t\r\n").lower()
    if (text.startswith(b"<?xml") or text.startswith(b"<svg") or text.startswith(b"<!--")) and b"<svg" in data[:4096].lower():
        return "svg"
    return None


def _check_extension(kind: str, filename: str | None) -> None:
    ext = (filename or "").rsplit(".", 1)[-1].lower() if "." in (filename or "") else ""
    if not ext:
        return
    claimed = EXTENSIONS.get(ext)
    if claimed is None:
        raise ImageError(f"'.{ext}' files are not supported. Upload {SUPPORTED_TEXT}.")
    if claimed != kind:
        raise ImageError(f"This file is named .{ext} but its content is {LABEL[kind]}. Rename it or export it again, then upload.")


_SVG_DANGER = re.compile(rb"<script\b|<!entity|<!doctype|<foreignobject\b|\bon[a-z]+\s*=|javascript:|<iframe\b|<embed\b|<object\b", re.I)
_SVG_HREF = re.compile(rb"""(?:xlink:)?href\s*=\s*["']\s*([^"'\s]*)""", re.I)


def _check_svg(data: bytes) -> None:
    if len(data) > MAX_SVG_BYTES:
        raise ImageError("The SVG is larger than 2 MB.")
    if _SVG_DANGER.search(data):
        raise ImageError("This SVG contains scripts, event handlers or embedded documents and was refused for safety. Export a plain SVG (or PNG) and upload that.")
    for ref in _SVG_HREF.findall(data):
        if ref and not (ref.startswith(b"#") or ref.lower().startswith(b"data:image/")):
            raise ImageError("This SVG links to outside files or web addresses and was refused for safety. Embed the images, or upload a PNG.")


# ── decoding to pixels ─────────────────────────────────────────────────────────

def _render_doc(data: bytes, filetype: str, page: int) -> tuple[Image.Image, int]:
    """A PDF page or an SVG rendered by PyMuPDF (no scripts/links are executed). Returns (image, page_count)."""
    import pymupdf

    try:
        doc = pymupdf.open(stream=data, filetype=filetype)
    except Exception as exc:
        raise ImageError(f"The {LABEL[filetype]} file is damaged or could not be read.") from exc
    try:
        if filetype == "pdf" and (doc.needs_pass or doc.is_encrypted):
            raise ImageError("This PDF is password-protected. Remove the password and upload it again.")
        count = doc.page_count
        if count < 1:
            raise ImageError("This PDF has no pages.")
        if count > MAX_PDF_PAGES:
            raise ImageError(f"This PDF has {count} pages; the limit is {MAX_PDF_PAGES}. Upload just the page you want.")
        if not 1 <= page <= count:
            raise ImageError(f"Page {page} does not exist; this PDF has {count} page{'s' if count != 1 else ''}.")
        p = doc[page - 1]
        w, h = max(p.rect.width, 1), max(p.rect.height, 1)
        zoom = min(4.0, (TARGET_MAX * 1.34) / max(w, h))  # render a little above the target, then downscale cleanly
        pix = p.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=(filetype == "svg"), annots=False)
        mode = "RGBA" if pix.alpha else "RGB"
        img = Image.frombytes(mode, (pix.width, pix.height), pix.samples)
        return img, count
    finally:
        doc.close()


def _open_raster(data: bytes, kind: str) -> Image.Image:
    if kind == "heif":
        import pillow_heif
        pillow_heif.register_heif_opener()
    try:
        img = Image.open(io.BytesIO(data))
        if (img.width or 0) * (img.height or 0) > MAX_PIXELS:
            raise ImageError(f"The image is {img.width} x {img.height} px, which is too large to process. Use one under 60 megapixels.")
        img.seek(0)  # GIF / animated WebP / multi-page TIFF: the first frame
        img.load()
    except Image.DecompressionBombError as exc:
        raise ImageError("The image is too large to process safely. Use one under 60 megapixels.") from exc
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, EOFError) as exc:
        raise ImageError(f"The {LABEL.get(kind, 'image')} file is damaged or could not be read.") from exc
    return ImageOps.exif_transpose(img)  # phone photos: apply the rotation stored in EXIF


def _has_alpha(img: Image.Image) -> bool:
    if img.mode in ("RGBA", "LA", "PA"):
        return img.getchannel("A").getextrema()[0] < 255
    return img.mode == "P" and "transparency" in img.info


# ── public API ─────────────────────────────────────────────────────────────────

def decode_upload(data_url: str) -> bytes:
    m = re.match(r"^data:([\w/+.-]*);base64,(.*)$", (data_url or "").strip(), re.S)
    raw = m.group(2) if m else (data_url or "")
    if len(raw) > MAX_INPUT_BYTES * 4 // 3 + 4096:
        raise ImageError(f"The file is larger than {MAX_INPUT_BYTES // (1024 * 1024)} MB. Use a smaller file.")
    try:
        data = base64.b64decode(raw, validate=False)
    except ValueError as exc:
        raise ImageError("The file could not be read. Try another file.") from exc
    if len(data) > MAX_INPUT_BYTES:
        raise ImageError(f"The file is larger than {MAX_INPUT_BYTES // (1024 * 1024)} MB. Use a smaller file.")
    if len(data) < MIN_BYTES:
        raise ImageError("The file is empty or too small to be an image.")
    return data


def convert(data: bytes, filename: str | None = None, page: int = 1) -> tuple[bytes, dict]:
    """Any supported upload -> (webp_bytes, info). Raises ImageError with a message for the user."""
    kind = sniff(data)
    if not kind:
        raise ImageError(f"This file is not a supported image. Upload {SUPPORTED_TEXT}.")
    _check_extension(kind, filename)
    page_count = None
    if kind == "svg":
        _check_svg(data)
        img, _ = _render_doc(data, "svg", 1)
    elif kind == "pdf":
        img, page_count = _render_doc(data, "pdf", max(1, int(page or 1)))
    else:
        img = _open_raster(data, kind)

    src_w, src_h = img.size
    alpha = _has_alpha(img)
    img = img.convert("RGBA" if alpha else "RGB")
    scale = min(1.0, TARGET_MAX / max(src_w, src_h))  # never upscale
    if scale < 1.0:
        img = img.resize((max(1, round(src_w * scale)), max(1, round(src_h * scale))), Image.Resampling.LANCZOS)
    def encode(**kw) -> bytes:
        out = io.BytesIO()
        img.save(out, "WEBP", method=6, **kw)
        return out.getvalue()

    # Photos compress best lossy (quality 82); logos, screenshots, line art and flat colours are usually smaller
    # and sharper lossless. Both are tried for graphic-like sources and the smaller one is kept.
    candidates = [("lossy", encode(quality=WEBP_QUALITY, exact=False))]
    if kind in ("png", "gif", "bmp", "svg", "pdf", "tiff", "webp") or alpha:
        candidates.append(("lossless", encode(lossless=True, quality=100)))
    encoding, webp = min(candidates, key=lambda c: len(c[1]))
    kept_original = False
    if kind == "webp" and scale == 1.0 and len(data) <= len(webp):  # already optimized: don't make it bigger
        webp, kept_original = data, True
    info = {
        "original_name": (filename or "").strip()[:200] or None,
        "original_format": LABEL[kind],
        "original_size": len(data),
        "original_width": src_w, "original_height": src_h,
        "width": img.width, "height": img.height,
        "size": len(webp), "format": "WebP", "encoding": "original" if kept_original else encoding,
        "saved_percent": max(0, round((1 - len(webp) / len(data)) * 100)) if data else 0,
        "transparent": alpha,
        "page": page if kind == "pdf" else None, "page_count": page_count,
        "kept_original": kept_original,
    }
    return webp, info


def save(business_id: int, article_id: int, data: bytes, ext: str, old_rel: str | None = None) -> str:
    """Store the image and return its path relative to UPLOAD_ROOT. The previous image of the article is removed."""
    folder = UPLOAD_ROOT / "articles" / str(int(business_id))
    folder.mkdir(parents=True, exist_ok=True)
    name = f"{int(article_id)}-{hashlib.sha256(data).hexdigest()[:12]}.{ext}"
    (folder / name).write_bytes(data)
    rel = f"articles/{int(business_id)}/{name}"
    if old_rel and old_rel != rel:
        remove(old_rel)
    return rel


def path_of(rel: str | None) -> Path | None:
    """The absolute file for a stored relative path, only if it is inside the uploads folder and exists."""
    if not rel:
        return None
    p = (UPLOAD_ROOT / rel).resolve()
    if UPLOAD_ROOT.resolve() not in p.parents or not p.is_file():
        return None
    return p


def remove(rel: str | None) -> None:
    p = path_of(rel)
    if p:
        p.unlink(missing_ok=True)


def media_type(rel: str) -> str:
    return TYPES.get(rel.rsplit(".", 1)[-1].lower(), "application/octet-stream")


def upload_filename(a, rel: str) -> str:
    """A readable, SEO-friendly file name for the media library: the article's slug."""
    slug = re.sub(r"[^a-z0-9]+", "-", (a.title or a.keyword or "featured-image").lower()).strip("-")[:70] or "featured-image"
    return f"{slug}.{rel.rsplit('.', 1)[-1].lower()}"
