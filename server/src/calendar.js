export function unescapeIcsText(text) {
  if (!text) return "";
  return text
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\n/g, "\n")
    .replace(/\\\\/g, "\\");
}

export function parseIcsDate(val) {
  if (!val) return new Date();
  if (val.length >= 8) {
    const y = val.substring(0, 4);
    const m = val.substring(4, 6);
    const d = val.substring(6, 8);
    if (val.includes("T")) {
      const h = val.substring(9, 11);
      const min = val.substring(11, 13);
      const s = val.substring(13, 15);
      const isUtc = val.endsWith("Z");
      if (isUtc) {
        return new Date(Date.UTC(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), parseInt(h, 10), parseInt(min, 10), parseInt(s, 10)));
      }
      return new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), parseInt(h, 10), parseInt(min, 10), parseInt(s, 10));
    }
    return new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
  }
  return new Date(val);
}

export function parseIcs(icsText) {
  if (!icsText) return [];
  const events = [];
  const lines = icsText.replace(/\r\n/g, "\n").replace(/\n /g, "").split("\n");

  let currentEvent = null;

  for (let rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line === "BEGIN:VEVENT") {
      currentEvent = {};
    } else if (line === "END:VEVENT") {
      if (currentEvent && currentEvent.summary && currentEvent.start) {
        events.push(currentEvent);
      }
      currentEvent = null;
    } else if (currentEvent) {
      const match = line.match(/^([^:;]+)(?:;[^:]*)?:(.*)$/);
      if (match) {
        const key = match[1];
        const val = match[2];

        if (key === "SUMMARY") {
          currentEvent.summary = unescapeIcsText(val);
        } else if (key === "DTSTART") {
          currentEvent.start = parseIcsDate(val);
        } else if (key === "DTEND") {
          currentEvent.end = parseIcsDate(val);
        }
      }
    }
  }
  return events;
}

export async function fetchAllCalendarEvents(urls = [], { fetchFn = fetch, timeoutMs = 8000 } = {}) {
  const allEvents = [];
  for (const url of urls) {
    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) {
        const text = await res.text();
        const parsed = parseIcs(text);
        allEvents.push(...parsed);
      }
    } catch {
      // Ignore failures for individual calendar feeds to remain resilient
    }
  }
  return allEvents;
}

export async function getUpcomingCalendarEvents(urls = [], { fetchFn = fetch, timeoutMs = 8000, limit = 5, days = 7 } = {}) {
  const allEvents = await fetchAllCalendarEvents(urls, { fetchFn, timeoutMs });
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const maxDate = new Date(startOfDay.getTime() + days * 24 * 60 * 60 * 1000);

  return allEvents
    .filter(e => e.start && e.start >= startOfDay && e.start <= maxDate)
    .sort((a, b) => a.start - b.start)
    .slice(0, limit)
    .map(e => ({
      summary: e.summary,
      start: e.start.toISOString(),
      end: e.end ? e.end.toISOString() : null,
    }));
}
