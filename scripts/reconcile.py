#!/usr/bin/env python3
"""Bidirectional reconcile between feeds.opml and a Readwise feed export.

Readwise is authoritative for *what is currently subscribed*. feeds.opml is the
source of truth for *organization* (folders) + curation metadata + brand-new feeds
not yet pushed to Readwise.

How to get the Readwise export (automatable via gstack headed browser):
    B=~/.claude/skills/gstack/browse/dist/browse
    $B stop; $B --headed goto https://read.readwise.io/profile     # headed = authed
    # click "Export Feeds as OPML" -> downloads to ~/Downloads/Reader_Feeds.opml
Readwise auth only works in HEADED mode (headless bounces to login). See
~/.claude CLAUDE.md "## Browser".

Usage:
    python scripts/reconcile.py                 # report only, no writes
    python scripts/reconcile.py --apply-pull    # add Readwise-only feeds INTO feeds.opml
    python scripts/reconcile.py --readwise /path/to/Reader_Feeds.opml

Matching: two feeds are "the same" if their normalized URL matches OR their
normalized title matches. Title matching catches substack custom-domain vs
*.substack.com (e.g. noahpinion.blog == noahpinion.substack.com) and www/scheme
differences that pure-URL diffing misses.

--apply-pull is the only write path and it is additive + git-reversible: it groups
Readwise-only feeds by their Readwise `category` into top-level folders in
feeds.opml. It never deletes feeds and never touches Readwise. Removals (feeds
unsubscribed in Readwise) and pushes (new local feeds -> Readwise) are reported as
explicit follow-up actions, not done automatically, because they are destructive /
outward-facing.
"""
import argparse, os, re, html, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL = os.path.join(ROOT, "feeds.opml")
DEFAULT_RW = os.path.expanduser("~/Downloads/Reader_Feeds.opml")

# Titles too generic to safely match on (would cause false merges).
GENERIC = {"substack", "newsletter", "blog", "feed", "rss", "home", "news"}

# Map Readwise's auto-categories onto existing feeds.opml folders so pulls land in
# the folders we curate instead of spawning near-duplicate folders. Categories not
# listed here keep their Readwise name (a new folder is created for them).
CATEGORY_ALIAS = {
    "Geopolitics & Economics": "Geopolitics",
    "Tech News & Strategy": "Tech Strategy",
    "Uncategorized": "Other",
    "SF Bay Area & Housing": "Real Estate",
}


def resolve_folder(category: str) -> str:
    """Readwise category (possibly multi-valued 'A,B') -> target feeds.opml folder."""
    first = (category or "Uncategorized").split(",")[0].strip() or "Uncategorized"
    return CATEGORY_ALIAS.get(first, first)


def norm_url(u: str) -> str:
    u = (u or "").strip().lower()
    u = re.sub(r"^https?://", "", u)
    u = re.sub(r"^www\.", "", u)
    return u.rstrip("/")


def norm_title(t: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (t or "").strip().lower())


def parse(path: str):
    """Return list of feed dicts {url, title, category, html, raw} from an OPML file.

    Tolerant of unescaped '&' in Readwise exports (regex, not a strict XML parser).
    Handles both text= (local) and title= (Readwise) for the display name.
    """
    txt = open(path, encoding="utf-8").read()
    feeds = []
    for mo in re.finditer(r"<outline\b[^>]*\bxmlUrl=\"([^\"]+)\"[^>]*?/?>", txt):
        tag = mo.group(0)
        url = html.unescape(mo.group(1))
        def attr(name):
            m = re.search(rf"\b{name}=\"([^\"]*)\"", tag)
            return html.unescape(m.group(1)) if m else ""
        feeds.append({
            "url": url,
            "title": attr("text") or attr("title"),
            "category": attr("category"),
            "html": attr("htmlUrl"),
        })
    return feeds


def index(feeds):
    urls, titles = {}, {}
    for f in feeds:
        urls[norm_url(f["url"])] = f
        nt = norm_title(f["title"])
        if len(nt) >= 4 and nt not in GENERIC:
            titles.setdefault(nt, f)
    return urls, titles


def matches(feed, urls, titles):
    if norm_url(feed["url"]) in urls:
        return True
    nt = norm_title(feed["title"])
    return len(nt) >= 4 and nt not in GENERIC and nt in titles


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--readwise", default=DEFAULT_RW)
    ap.add_argument("--apply-pull", action="store_true",
                    help="add Readwise-only feeds into feeds.opml (grouped by category)")
    args = ap.parse_args()

    if not os.path.exists(args.readwise):
        sys.exit(f"Readwise export not found: {args.readwise}\nExport it first (see module docstring).")

    local = parse(LOCAL)
    rw = parse(args.readwise)
    l_urls, l_titles = index(local)
    r_urls, r_titles = index(rw)

    only_rw = [f for f in rw if not matches(f, l_urls, l_titles)]
    only_local = [f for f in local if not matches(f, r_urls, r_titles)]
    both = len(local) - len(only_local)

    # classify only_local
    synthetic = [f for f in only_local if "rss.jasonbenn.com" in f["url"]]
    youtube = [f for f in only_local if "youtube.com" in f["url"]]
    push_or_drop = [f for f in only_local if f not in synthetic and f not in youtube]

    print(f"local feeds.opml : {len(local)}")
    print(f"Readwise export  : {len(rw)}")
    print(f"matched (in both): {both}\n")

    print(f"== PULL: in Readwise, missing from feeds.opml ({len(only_rw)}) ==")
    by_cat = {}
    for f in only_rw:
        by_cat.setdefault(resolve_folder(f["category"]), []).append(f)
    for cat in sorted(by_cat):
        print(f"  [{cat}] {len(by_cat[cat])}")
    print()

    print(f"== REVIEW: in feeds.opml, missing from Readwise ({len(push_or_drop)} real"
          f" + {len(synthetic)} synthetic + {len(youtube)} youtube) ==")
    print("   (each is either a new feed to PUSH to Readwise, or an UNSUBSCRIBE to drop from local)")
    for f in sorted(push_or_drop, key=lambda x: x["title"].lower()):
        print(f"  {f['title']}  ->  {f['url']}")

    if args.apply_pull:
        apply_pull(by_cat)


def esc(s: str) -> str:
    return (s or "").replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;").replace(">", "&gt;")


def _feed_line(f) -> str:
    attrs = f'type="rss" text="{esc(f["title"])}" xmlUrl="{esc(f["url"])}"'
    if f["html"]:
        attrs += f' htmlUrl="{esc(f["html"])}"'
    return f"      <outline {attrs} />"


def apply_pull(by_cat):
    """Pull Readwise-only feeds into feeds.opml. For folders that already exist,
    append the feeds before their closing </outline> (no duplicate folders). For
    new folders, create them just before </body>. Additive only."""
    txt = open(LOCAL, encoding="utf-8").read()
    new_folder_blocks = []
    for cat in sorted(by_cat):
        lines = [_feed_line(f) for f in sorted(by_cat[cat], key=lambda x: x["title"].lower())]
        # does this folder already exist as a top-level outline?
        pat = re.compile(r'<outline text="' + re.escape(esc(cat)) + r'" title="[^"]*">(.*?)\n    </outline>\n', re.DOTALL)
        m = pat.search(txt)
        if m:  # append into existing folder, before its </outline>
            insert_at = m.end(1)
            txt = txt[:insert_at] + "\n" + "\n".join(lines) + txt[insert_at:]
        else:  # stage a new folder block
            new_folder_blocks.append(f'    <outline text="{esc(cat)}" title="{esc(cat)}">\n'
                                     + "\n".join(lines) + "\n    </outline>")
    if new_folder_blocks:
        if "</body>" not in txt:
            sys.exit("could not find </body> in feeds.opml")
        insert = "\n    <!-- Pulled from Readwise (reconcile.py) -->\n" + "\n".join(new_folder_blocks) + "\n"
        txt = txt.replace("</body>", insert + "  </body>", 1)
    open(LOCAL, "w", encoding="utf-8").write(txt)
    n = sum(len(v) for v in by_cat.values())
    print(f"\nApplied: pulled {n} feeds into {len(by_cat)} folders "
          f"({len(new_folder_blocks)} newly created).")


if __name__ == "__main__":
    main()
