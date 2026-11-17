import { expect, it, describe } from "vitest";
import { eventPagePlace, embeddedVenuePoint, extractJsonLd } from "@/src/adapters/feeds/jsonld";
import { EVENT_PAGES_PER_RUN } from "@/src/pipeline/event-page-venue";

it("eventPagePlace returns location from embedded Venue when JSON-LD has none", () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Event",
          "name": "Meetup Event",
          "location": {
            "@type": "Place",
            "name": "Mambame Studio",
            "address": {
              "@type": "PostalAddress",
              "streetAddress": "Carrer dels Enamorats, 103",
              "addressLocality": "Barcelona",
              "postalCode": "08026",
              "addressCountry": "Spanien",
              "addressRegion": "Local 4"
            }
          }
        }
        </script>
        <script id="__NEXT_DATA__" type="application/json">
        {
          "props": {
            "pageProps": {
              "event": {
                "venue": {"__ref": "Venue:27300758"}
              }
            }
          },
          "__NEXT_DATA__": true
        }
        </script>
      </head>
      <body>
        <script>
          // Embedded Venue object
          {"__typename":"Venue","id":"27300758","googleMapsUrl":null,"name":"Mambame Studio","address":"Carrer dels Enamorats, 103, Barcelona, Local 4, 08026, Spanien","city":"Barcelona","state":"","country":"es","lat":41.406654,"lng":2.183291}
        </script>
      </body>
    </html>
  `;
  const place = eventPagePlace(html);
  expect(place).not.toBeNull();
  expect(place!.address).toBe("Carrer dels Enamorats, 103, Barcelona, Local 4, 08026, Spanien");
  expect(place!.location).toEqual({ lat: 41.406654, lng: 2.183291 });
});

it("JSON-LD geo point wins over embedded Venue point", () => {
  const html = `
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Event",
      "location": {
        "@type": "Place",
        "address": "Some Address",
        "geo": {
          "@type": "GeoCoordinates",
          "latitude": 1,
          "longitude": 2
        }
      }
    }
    </script>
    <script>
      {"__typename":"Venue","address":"Some Address","lat":3,"lng":4}
    </script>
  `;
  const place = eventPagePlace(html);
  expect(place!.location).toEqual({ lat: 1, lng: 2 });
});

it("embeddedVenuePoint returns null when no Venue objects", () => {
  const html = `<html></html>`;
  expect(embeddedVenuePoint(html, "any")).toBeNull();
});

it("embeddedVenuePoint returns null when two Venue objects with different points and no address match", () => {
  const html = `
    <script>
      {"__typename":"Venue","address":"Address A","lat":10,"lng":20}
      {"__typename":"Venue","address":"Address B","lat":30,"lng":40}
    </script>
  `;
  expect(embeddedVenuePoint(html, "Address C")).toBeNull();
});

it("embeddedVenuePoint ignores lat/lng 0", () => {
  const html = `
    <script>
      {"__typename":"Venue","address":"Some Address","lat":0,"lng":0}
    </script>
  `;
  expect(embeddedVenuePoint(html, "Some Address")).toBeNull();
});

it("embeddedVenuePoint handles bad JSON gracefully", () => {
  const html = `
    <script>
      {"__typename":"Venue", invalid}
    </script>
  `;
  expect(embeddedVenuePoint(html, "any")).toBeNull();
});

it("EVENT_PAGES_PER_RUN is 60", () => {
  expect(EVENT_PAGES_PER_RUN).toBe(60);
});

describe("JSON-LD with a \\' escape (WordPress MEC, viajandoybailando.com)", () => {
  const html = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"Event","name":"Latin Jazz","startDate":"2026-10-29T20:00:00-04:00","location":{"@type":"Place","name":"Música Bar &amp; Lounge","address":{"@type":"PostalAddress","streetAddress":"Calle Loiza #2057, Pagan\\'s Building Plaza","addressLocality":"Carolina","postalCode":"00913","addressCountry":"PR"}}}</script></head><body></body></html>`;
  it("parses the block and gives the place", () => {
    expect(extractJsonLd(html).invalid).toBe(0);
    const place = eventPagePlace(html);
    expect(place?.address).toContain("Pagan's Building Plaza");
    expect(place?.name).toBe("Música Bar & Lounge");
  });
});
