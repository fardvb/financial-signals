import type { AssetClass, EventCategory } from '@/types'

// Magnitude (0-1) of how much a headline in this event category should move confidence
// for an asset in this class. This is the "weighted matrix" — it's what stops a regional
// war and an unrelated corporate-earnings headline from being treated as equally material.
export const EVENT_WEIGHTS: Record<EventCategory, Record<AssetClass, number>> = {
  'geopolitical-conflict': {
    'safe-haven': 0.95,
    'industrial-metal': 0.45,
    energy: 0.9,
    'broad-index': 0.55,
    forex: 0.35,
    'defense-equity': 0.95,
    'general-equity': 0.25,
  },
  'currency-crisis': {
    'safe-haven': 0.55,
    'industrial-metal': 0.25,
    energy: 0.3,
    'broad-index': 0.3,
    forex: 0.9,
    'defense-equity': 0.15,
    'general-equity': 0.2,
  },
  'central-bank-policy': {
    'safe-haven': 0.6,
    'industrial-metal': 0.55,
    energy: 0.4,
    'broad-index': 0.85,
    forex: 0.85,
    'defense-equity': 0.35,
    'general-equity': 0.6,
  },
  sanctions: {
    'safe-haven': 0.5,
    'industrial-metal': 0.6,
    energy: 0.75,
    'broad-index': 0.35,
    forex: 0.45,
    'defense-equity': 0.7,
    'general-equity': 0.3,
  },
  'supply-disruption': {
    'safe-haven': 0.25,
    'industrial-metal': 0.8,
    energy: 0.85,
    'broad-index': 0.35,
    forex: 0.2,
    'defense-equity': 0.3,
    'general-equity': 0.4,
  },
  'corporate-earnings': {
    'safe-haven': 0.05,
    'industrial-metal': 0.15,
    energy: 0.15,
    'broad-index': 0.4,
    forex: 0.1,
    'defense-equity': 0.85,
    'general-equity': 0.9,
  },
  regulatory: {
    'safe-haven': 0.1,
    'industrial-metal': 0.3,
    energy: 0.4,
    'broad-index': 0.3,
    forex: 0.15,
    'defense-equity': 0.55,
    'general-equity': 0.55,
  },
  'analyst-rating': {
    'safe-haven': 0.05,
    'industrial-metal': 0.2,
    energy: 0.2,
    'broad-index': 0.25,
    forex: 0.1,
    'defense-equity': 0.6,
    'general-equity': 0.7,
  },
  'routine-macro': {
    'safe-haven': 0.3,
    'industrial-metal': 0.35,
    energy: 0.3,
    'broad-index': 0.5,
    forex: 0.4,
    'defense-equity': 0.2,
    'general-equity': 0.3,
  },
  other: {
    'safe-haven': 0.2,
    'industrial-metal': 0.2,
    energy: 0.2,
    'broad-index': 0.2,
    forex: 0.2,
    'defense-equity': 0.2,
    'general-equity': 0.2,
  },
}

export const EVENT_CATEGORIES = Object.keys(EVENT_WEIGHTS) as EventCategory[]

export function isEventCategory(value: unknown): value is EventCategory {
  return typeof value === 'string' && (EVENT_CATEGORIES as string[]).includes(value)
}
