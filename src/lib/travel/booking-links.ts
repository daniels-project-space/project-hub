// Cashback booking deep links (2026-07-03). Daniel earns cashback on these
// five portals, so every stay surface offers a prefilled click-through to each
// — the cashback tracks as long as the booking happens on the provider's site
// (portal/extension side), which a deep link doesn't interfere with.
//
// None of these expose a public search API; all accept URL query params.
// Formats probed live 2026-07-03 (booking/trivago/trip.com resolve directly;
// expedia's is its canonical public format; lastminute only supports a city
// landing page — dates can't be prefilled there).

export type BookingQuery = {
  city: string;
  checkIn?: string; // ISO YYYY-MM-DD
  checkOut?: string;
  adults?: number;
};

export type BookingProvider = {
  key: string;
  label: string;
  url: (q: BookingQuery) => string;
};

const enc = encodeURIComponent;

export const BOOKING_PROVIDERS: BookingProvider[] = [
  {
    key: "booking",
    label: "Booking.com",
    url: ({ city, checkIn, checkOut, adults }) =>
      `https://www.booking.com/searchresults.html?ss=${enc(city)}` +
      (checkIn ? `&checkin=${checkIn}` : "") +
      (checkOut ? `&checkout=${checkOut}` : "") +
      `&group_adults=${adults ?? 1}&no_rooms=1`,
  },
  {
    key: "expedia",
    label: "Expedia",
    url: ({ city, checkIn, checkOut, adults }) =>
      `https://www.expedia.co.uk/Hotel-Search?destination=${enc(city)}` +
      (checkIn ? `&startDate=${checkIn}` : "") +
      (checkOut ? `&endDate=${checkOut}` : "") +
      `&adults=${adults ?? 1}`,
  },
  {
    key: "trivago",
    label: "Trivago",
    url: ({ city }) => `https://www.trivago.co.uk/en-GB/srl?search=${enc(city)}`,
  },
  {
    key: "lastminute",
    label: "lastminute",
    // Only a city landing resolves (probed: /hotels/<city>.html 301s to the
    // real /hotels/city/hotels-in-<City>/ page). No date prefill available.
    url: ({ city }) =>
      `https://www.lastminute.com/hotels/${enc(city.toLowerCase().replace(/\s+/g, "-"))}.html`,
  },
  {
    key: "hotels",
    label: "Hotels.com",
    url: ({ city, checkIn, checkOut, adults }) =>
      `https://www.hotels.com/Hotel-Search?destination=${enc(city)}` +
      (checkIn ? `&startDate=${checkIn}` : "") +
      (checkOut ? `&endDate=${checkOut}` : "") +
      `&adults=${adults ?? 1}`,
  },
  {
    key: "stayforlong",
    label: "Stayforlong",
    // Long-stay specialist. Their search is JS-only (no deep-linkable params —
    // probed 2026-07-04: /search, /hotels/{...} all 404) → land on the site.
    url: () => "https://www.stayforlong.co.uk/uk-en/",
  },
  {
    key: "trip",
    label: "Trip.com",
    url: ({ city, checkIn, checkOut, adults }) =>
      `https://uk.trip.com/hotels/list?cityName=${enc(city)}` +
      (checkIn ? `&checkin=${checkIn}` : "") +
      (checkOut ? `&checkout=${checkOut}` : "") +
      `&adult=${adults ?? 1}&crn=1`,
  },
];
