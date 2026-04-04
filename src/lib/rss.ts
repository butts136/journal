import { XMLParser } from "fast-xml-parser";

export type RssItem = {
  title: string;
  guid: string | null;
  pubDate: string | null;
  comments: string | null;
  link: string | null;
  enclosureUrl: string | null;
  size: number | null;
  coverUrl: string | null;
  infoHash: string | null;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: true,
  trimValues: true,
});

function getAttrValue(
  torznabAttr: Array<{ name?: string; value?: string }> | { name?: string; value?: string } | undefined,
  key: string,
) {
  if (!torznabAttr) {
    return null;
  }

  const attrs = Array.isArray(torznabAttr) ? torznabAttr : [torznabAttr];
  const match = attrs.find((entry) => entry.name === key);
  return match?.value ?? null;
}

function withQuery(urlString: string, query: string) {
  const url = new URL(urlString);

  if (url.searchParams.get("t") === "search") {
    url.searchParams.set("q", query);
  }

  return url.toString();
}

export async function fetchRssItems(feedUrl: string, query?: string) {
  const targetUrl = query ? withQuery(feedUrl, query) : feedUrl;
  const response = await fetch(targetUrl, {
    cache: "no-store",
    headers: {
      "user-agent": "Le-Kiosque/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Flux RSS inaccessible: ${response.status}`);
  }

  const xml = await response.text();
  const parsed = parser.parse(xml);
  const rawItems = parsed?.rss?.channel?.item ?? [];
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];

  return items
    .filter(Boolean)
    .map(
      (item): RssItem => ({
        title: String(item.title ?? ""),
        guid: item.guid ? String(item.guid) : null,
        pubDate: item.pubDate ? String(item.pubDate) : null,
        comments: item.comments ? String(item.comments) : null,
        link: item.link ? String(item.link) : null,
        enclosureUrl: item.enclosure?.url ? String(item.enclosure.url) : null,
        size: item.size ? Number(item.size) : null,
        coverUrl: getAttrValue(item["torznab:attr"], "coverurl"),
        infoHash: getAttrValue(item["torznab:attr"], "infohash"),
      }),
    );
}

export function isQueryableSearchFeed(feedUrl: string) {
  try {
    const url = new URL(feedUrl);
    return url.searchParams.get("t") === "search";
  } catch {
    return false;
  }
}
