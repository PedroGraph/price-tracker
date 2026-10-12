/**
 * What changed in each version, shown once in a pop-up after the app updates. Add an entry
 * at the top when bumping `version` in package.json; a version without an entry shows nothing.
 */
export interface WhatsNewEntry {
  version: string
  notes: Record<'en' | 'es', string[]>
}

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    version: '1.4.0',
    notes: {
      en: [
        'A new look for the whole app, and the pages (Dashboard, Shipments, Statistics, Settings) are now in the top bar.',
        'Product cards show at a glance where today’s price sits against the recent ones.',
        'Statistics: a full-width price chart for up to four products, and a new map of when your products tend to be cheapest.',
        'Shipments: each one unfolds into its five steps, with what the carrier says and its history of movements.',
        'Any product can be removed, from its card or its page, and it stays removed even while it’s still in your cart.',
        'Products that Amazon can’t ship to your address are now marked out of stock instead of going unread.'
      ],
      es: [
        'Nueva apariencia para toda la app, y las páginas (Dashboard, Envíos, Estadísticas, Configuración) ahora están en la barra superior.',
        'Las tarjetas de producto muestran de un vistazo dónde está el precio de hoy frente a los recientes.',
        'Estadísticas: una gráfica de precios a todo el ancho para hasta cuatro productos, y un mapa nuevo de cuándo suelen estar más baratos.',
        'Envíos: cada uno se despliega en sus cinco pasos, con lo que dice la transportadora y su historial de movimientos.',
        'Cualquier producto se puede quitar, desde su tarjeta o su página, y se queda quitado aunque siga en tu carrito.',
        'Los productos que Amazon no puede enviar a tu dirección ahora se marcan sin stock en vez de quedarse sin leer.'
      ]
    }
  },
  {
    version: '1.3.0',
    notes: {
      en: [
        'Shipments: a new section (the truck icon) for what you bought in any store, with who carries it, its tracking number and where it is.',
        'Servientrega is tracked by itself: the app reads the status and its history, and tells you when it changes.',
        'Connect your Encargomio, Temu and Amazon accounts and their orders show up in Shipments on their own, with the carrier, the tracking number and the history.',
        'The language now follows Windows unless you pick one in Settings.',
        'Alerts are no longer repeated or lost when email or Telegram fails, and the price comparison shows the other stores’ pictures.'
      ],
      es: [
        'Envíos: una sección nueva (el ícono del camión) para lo que compraste en cualquier tienda, con quién lo trae, su guía y dónde va.',
        'Servientrega se rastrea sola: la app lee el estado y su historial, y te avisa cuando cambia.',
        'Conecta tus cuentas de Encargomio, Temu y Amazon y sus pedidos aparecen solos en Envíos, con la transportadora, la guía y el historial.',
        'El idioma ahora sigue el de Windows, salvo que elijas uno en Configuración.',
        'Las alertas ya no se repiten ni se pierden cuando falla el email o Telegram, y la comparación de precios muestra las fotos de las otras tiendas.'
      ]
    }
  }
]

/** Negative when `a` is older than `b`. Compares the numbers of "1.2.10"-style versions. */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [a, b].map((v) => v.split('.').map((n) => Number.parseInt(n, 10) || 0))
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** The entries newer than the last version seen, up to the running one, newest first. */
export function newsSince(lastSeen: string, current: string, entries = WHATS_NEW): WhatsNewEntry[] {
  return entries
    .filter((e) => compareVersions(e.version, lastSeen) > 0 && compareVersions(e.version, current) <= 0)
    .sort((a, b) => compareVersions(b.version, a.version))
}
