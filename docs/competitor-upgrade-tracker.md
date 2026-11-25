# Competitor Analysis upgrade: tracker

Branch: `feature/competitor-analysis-upgrade`. Data rule: Apify = DA/PA/spam + ranked keywords. Anything no provider gives shows "Not Available".
Status: DONE = built and tested. PARTIAL = part of it works. TODO = not started.

## Done
| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Summary cards: discovered / selected / analyzed / avg DA with definitions | DONE | counts are separate, unique domains, avg DA skips missing |
| 2 | Competitor table: separate name, domain, location/distance, last analyzed columns | DONE | |
| 3 | Table filters: status, location, DA band, selection | DONE | |
| 4 | Metric tooltips naming the source | DONE | |
| 5 | Analysis history (one record per run, never overwritten) | DONE | migration 0027, not applied to real DB |
| 6 | Statuses: Pending, Queued, Analyzing, Analyzed, Partly read, Failed, Needs retry | DONE | analyzed only when DA and keywords both read |
| 7 | Per-part provider, missing metrics, error stored per run | DONE | |
| 8 | Provider usage log + endpoint | DONE | no UI view yet |
| 9 | Cleaned domain + discovery sources per competitor, no duplicate domains | DONE | Maps and manual only |
| 10 | Direct / indirect flag | DONE | |
| 11 | Already existed, kept: search, sort, paging, Columns menu, CSV, bulk select/analyze/remove with confirm, relevance score with 9 factors, auto-analyze toggle, keyword mapping, saved keywords | KEPT | |

## Left
| # | Phase | Item | Status | Needs |
|---|-------|------|--------|-------|
| A | 2 | Summary cards/table: Referring domains, Not Available/Not Connected states per metric | PARTIAL | none |
| B | 2/3 | Match score drawer: score, label, reason, every measured factor with weight and points added, factors left out, cap note | DONE | uses the existing nine factors (category, services, area, keywords, SERP, intent, page, opportunity, traffic). Built, not clicked through in a browser |
| C | 3 | Discovery inputs: business category, up to 3 primary services, seed keywords, country, language, radius; refresh from Maps; duplicates merged by domain, source kept | DONE | Maps discovery only. Organic search discovery is D. Business name as an input is not added (the project's own name is already excluded). Built, not clicked through in a browser |
| D | 3 | Organic search discovery (competitor domains from SERP) | TODO | provider decision |
| E | 4 | Auto-analyze settings: new competitors, Domain Authority, keywords, retry failed (tries in a row), refresh period, cache hours, daily limit | DONE | per project, saved at once; scheduler runs retries and refresh |
| F | 4/16 | Caching (no repeat reads within cache hours), daily limit, provider pause after quota/429, one in-run retry on temporary errors, 30-minute wait between retries, scheduler hook | DONE | queue is still one competitor at a time per project, in memory (lost on restart; the scheduler picks up what is due) |
| G | 16 | Usage view: calls, failures and cost per provider, today's reads vs limit, pauses, latest calls | DONE | in Settings and usage on the Competitors tab. Built, not clicked through in a browser |
| H | 5 | Competitor keywords: pick several competitors, position/volume/KD ranges, ranking-page filter, ticked + all-filtered Add to My Keywords, detail drawer, Last updated, CPC | DONE | built, not clicked through in a browser yet. SERP features column shows Not available (no source). Drawer has no SERP overview (not kept) |
| I | 5/13 | Save to My Keywords without duplicates: existing keywords are named in the answer and get the new source | DONE | bulk send and filtered-send already existed; per-row Add button still TODO |
| J | 12/13 | One keyword keeps every source (Competitor Keywords / Competitor Gap / Keyword Research / Manual Entry) | DONE | stored as a list inside keyword.source, not a separate table |
| K | 6 | Keyword Gap: Missing / Weak / Shared / Strong / Only you, Opportunity score with documented formula, a position column per competitor, Opportunity-type filter | DONE | formula in `opportunity()` and the column tooltip. Device type and target-location inputs still TODO (same market only). Not clicked through in a browser |
| L | 7 | Traffic: Estimated vs Verified labels, share-of-traffic bar, top traffic keywords per competitor, trend from real analysis runs only (needs 2+ runs), comparison charts | DONE | no fabricated history. Built, not clicked through in a browser |
| M | 8 | Top pages: URL, est. traffic, ranking keywords, top keyword + position, page drawer (keywords with your position, page-level opportunities, related terms, content opportunities + add to My Keywords) | DONE | page title and page-level backlinks show Not available: no connected provider reads them |
| N | 9 | Backlinks: new/lost, follow/nofollow, anchor text | TODO | provider decision |
| O | 10 | Google Maps tab in two separate parts: Found on Google Maps (discovery table: name, category, address, distance, rating, reviews, website, Maps link, services, filters, CSV) and Local rank tracking (the existing street-grid and by-area tracker with competitor comparison, embedded). Research-run Maps results kept as a third view | DONE | the tab now shows before a research run. Category and services show Not available until a research run or a listing read has supplied them (the saved competitor has no category column). Not clicked through in a browser |
| P | 11 | Research tab with four sections: Keyword Discovery (seeds, services, places; searches, KD, CPC, intent, questions), Competitor Research (multi-competitor keywords with filters), Location-Based Keywords (service x chosen places x phrase shapes, searches checked), Keyword Opportunities (missing, low KD, high volume, commercial, long-tail, question) with bulk save to My Keywords | DONE | built on existing endpoints, no backend change. Tab now shows before a research run; the old run view is a fifth section. Not clicked through in a browser. Related-keyword ideas from Keyword Planner are not shown separately |
| Q | 14 | Keyword mapping: status per keyword (not mapped, mapped, optimization required, new page required, completed; the last three set by hand, the first two worked out), cannibalization risks (pages carrying a keyword about equally; the same words sent to different pages), duplicate page targeting (two main keywords on a page, same words in a different order), bulk assign to a page / main / supporting / status, Mapping column in My Keywords | DONE | risks come from the saved keywords and the last site scan, not from real ranking data. Not clicked through in a browser |
| R | 17 | End-to-end check: API workflow test (discover, select, analyze with a failing provider, keywords, gap, traffic, pages, trend, save without duplicates, map, refresh keeps history, project privacy, 3,000-keyword set) plus a real Chrome pass over 22 screens on a scratch database | DONE | found and fixed 3 defects (see below). Not covered: real provider calls (Apify, Places, DataForSEO), a second browser, mobile widths, the discovery run button against live Places |
| S | - | Schema on dev DB (already there, app creates it at start-up; alembic_version is stale, so upgrade was not run); committed | DONE | |



## Defects found by the end-to-end check (fixed)
1. Saving the same keyword twice in one request (two competitors rank for it) crashed with a server error. Now it is one record with both sources.
2. A competitor with no website became the domain "null" in the browser, and the server accepted it. The helper is fixed and the server now rejects anything that is not a website domain.
3. The progress line showed "now null"; a missing HTTPException import in the keyword-workspace router would also have broken its error paths.

## Test status
- Full backend suite (with the two HTTPS variables in .env blanked, see below): 1208 passed, 9 failed. All 9 fail identically on the commit before this branch: test_auth::test_login_flow, 2 in test_keyword_paragraphs, 5 in test_backlink_scores and 1 in test_site_authority (the last 6 only fail when run after other tests).
- Environment note: backend/.env has HTTPS PUBLIC_BASE_URL and FRONTEND_URL, which make test logins fail (secure cookies over http). Run the suite with `PUBLIC_BASE_URL= FRONTEND_URL= python -m pytest`.
- The frontend's .env points API calls at http://localhost:8000. A browser test must start Vite with `VITE_API_URL=/api/v1` and `BACKEND_URL=<test backend>` or it talks to the real backend.

## Redesign: 4-step guided flow (agreed with the owner)
Rules from the owner: no tab bars anywhere (moving between views is done with buttons only); the tables keep ALL their columns, filters, exports and actions (nothing erased): only the layout changes.
- Step bar, Step 1 Find (simple form, More options folded), Step 2 Shortlist (plain list with Choose / Chosen buttons): DONE.
- Step 3 Analyze: the full original competitor table with all its columns, the four summary cards, the auto-analyze bar, Columns menu, CSV export and bulk actions. Filters are folded behind one Filters button.
- Step 4 Opportunities: seven big buttons (Keywords to win = the full keyword gap, All competitor keywords = the full competitor keyword table, Their best pages, Traffic compared, Backlinks compared, On Google Maps, Find new keywords), each with an "All opportunities" back button. Every table keeps all its columns and filters; filters are folded behind a Filters button and the range filters behind a "Ranges and page" button.
- DataTable has a new optional prop, collapseFilters (default off), so no other page in the app changes.
- Auto-analyze again reads every competitor found, as before the redesign (an earlier version of the redesign limited it to the chosen ones).
- Browser checks: 18 of 18 (full table and every column, filters, bulk actions, drawer, add-to-My-Keywords, old links).
- Removed from the page and no longer used (still in the code): my trimmed Analyze table, the merged Keywords view and the competitor detail window. They can be deleted.

## Layout change: home screen of four cards (owner's choice, replaces the step bar across the top)
- /competitor-finder opens on a home screen with four big cards (Find competitors, Choose competitors, Analyze, Opportunities), each with its real status and one button; only the next thing to do is highlighted. No bar or tabs across the top.
- Every other page has one "Back to Competitors" button and a "My competitors" button. Inside Opportunities, an "All opportunities" button goes back one level.
- Old links (?tab=..., ?step=...) still open the right page directly.
- 8 browser checks pass; the full tables, columns and filters are unchanged.
