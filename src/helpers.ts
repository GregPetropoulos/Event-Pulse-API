export const normalizeEvents = (tm: any)=> {
  const events = tm?._embedded?.events ?? []

  return events.map((e: any) => ({
    id: e.id,
    title: e.name,
    date: e.dates?.start?.dateTime,
    venue: e._embedded?.venues?.[0]?.name,
    city: e._embedded?.venues?.[0]?.city?.name,
    lat: Number(e._embedded?.venues?.[0]?.location?.latitude),
    lng: Number(e._embedded?.venues?.[0]?.location?.longitude),
    image: e.images?.[0]?.url ?? null,
    url: e.url,
  }))
}
