"""
Find top competitors near a location using the Google Places API (New).

SETUP
1. Get an API key: https://console.cloud.google.com/  ->  create project
   -> enable "Places API (New)" -> Credentials -> Create API key.
   (Billing must be enabled on the project.)
2. pip install requests
3. Put your key below, or set it as an environment variable:
      Windows:  set GOOGLE_API_KEY=your_key
      Mac/Linux: export GOOGLE_API_KEY=your_key
4. Run:  python find_competitors.py
"""

import csv
import os
import sys

import requests

API_KEY = os.environ.get("GOOGLE_API_KEY", "AIzaSyCb8Z28i4iv0ayiS-o6K6qEplhGgZnh89Q")
URL = "https://places.googleapis.com/v1/places:searchText"

# Fields we want back (the field mask controls what you are billed for)
FIELDS = ",".join([
    "places.displayName",
    "places.formattedAddress",
    "places.rating",
    "places.userRatingCount",
    "places.websiteUri",
    "places.nationalPhoneNumber",
    "places.googleMapsUri",
    "places.businessStatus",
])


def find_competitors(business_type, location, own_firm_name="", top_n=10):
    """Search Google Maps for `business_type` in `location` and return top_n results."""
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": API_KEY,
        "X-Goog-FieldMask": FIELDS,
    }
    body = {
        "textQuery": f"{business_type} in {location}",
        "regionCode": "IN",
        "languageCode": "en",
        "pageSize": 20,  # fetch extra so we can drop your own firm and still have 10
    }

    resp = requests.post(URL, headers=headers, json=body, timeout=30)
    if resp.status_code != 200:
        sys.exit(f"API error {resp.status_code}: {resp.text}")

    results = []
    for p in resp.json().get("places", []):
        name = p.get("displayName", {}).get("text", "")
        # Skip your own firm and permanently closed businesses
        if own_firm_name and own_firm_name.lower() in name.lower():
            continue
        if p.get("businessStatus") == "CLOSED_PERMANENTLY":
            continue
        results.append({
            "name": name,
            "rating": p.get("rating", ""),
            "reviews": p.get("userRatingCount", 0),
            "address": p.get("formattedAddress", ""),
            "phone": p.get("nationalPhoneNumber", ""),
            "website": p.get("websiteUri", ""),
            "maps_link": p.get("googleMapsUri", ""),
        })
    return results[:top_n]


def save_csv(rows, filename="competitors.csv"):
    with open(filename, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
    print(f"\nSaved to {filename}")


def main():
    if API_KEY == "PASTE_YOUR_API_KEY_HERE":
        sys.exit("Please add your Google API key first (see instructions at top of file).")

    business_type = input("Business type [digital marketing agency]: ").strip() \
        or "digital marketing agency"
    location = input("Your firm's location (area / address, e.g. Baner, Pune): ").strip()
    own_firm = input("Your firm's name (to exclude from results, optional): ").strip()

    if not location:
        sys.exit("Location is required.")

    rows = find_competitors(business_type, location, own_firm)
    if not rows:
        sys.exit("No results found. Try a broader location.")

    print(f"\nTop {len(rows)} competitors for '{business_type}' near {location}\n")
    print("-" * 70)
    for i, r in enumerate(rows, 1):
        print(f"{i}. {r['name']}")
        print(f"   Rating : {r['rating']} ({r['reviews']} reviews)")
        print(f"   Address: {r['address']}")
        print(f"   Phone  : {r['phone']}")
        print(f"   Website: {r['website']}")
        print(f"   Maps   : {r['maps_link']}")
        print("-" * 70)

    save_csv(rows)


if __name__ == "__main__":
    main()