// Waypoints' pure logic: names, the transcript cut at a pin, and the handoff prompt.

import type { Fork, Waypoint } from '../types'

export type Message = { role: 'user' | 'assistant'; text: string; toolUses: readonly { tool: string; input: Record<string, unknown> }[] }

/** A short kebab-case name from the reply's first words: "Plan: keep JWT…" → "plan-keep-jwt". */
export function slug(text: string, taken: readonly string[]): string {
  const words = text
    .toLowerCase()
    .replace(/[`*_#>\[\]()]/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter(w => w.length > 1)
    .slice(0, 3)
  const base = words.join('-') || 'waypoint'
  if (!taken.includes(base)) return base
  let n = 2
  while (taken.includes(`${base}-${n}`)) n++
  return `${base}-${n}`
}

/** Names someone typed, made safe: lower case, letters, digits and hyphens. */
export function cleanName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

export function excerpt(text: string, max = 90): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length <= max ? one : `${one.slice(0, max - 1).trimEnd()}…`
}

/** The index of the last assistant message with text, or -1. */
export function lastReply(messages: readonly Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.role === 'assistant' && m.text.trim()) return i
  }
  return -1
}

/** The index of the assistant message a drawn reply block belongs to, or -1. */
export function replyHolding(messages: readonly Message[], block: string): number {
  const needle = block.trim().slice(0, 200)
  if (!needle) return -1
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.role === 'assistant' && m.text.includes(needle)) return i
  }
  return -1
}

/** How many of the person's own messages came up to and including `index`: the turn number. */
export function turnAt(messages: readonly Message[], index: number): number {
  return messages.slice(0, index + 1).filter(m => m.role === 'user' && m.text.trim()).length
}

/** The conversation up to and including the pinned reply, as plain text, newest kept when long. */
export function transcriptUpTo(messages: readonly Message[], index: number, maxChars = 120_000): string {
  const lines: string[] = []
  for (const m of messages.slice(0, index + 1)) {
    const tools = m.toolUses.map(t => `[${t.tool}${typeof t.input.file_path === 'string' ? ` ${t.input.file_path}` : typeof t.input.command === 'string' ? ` ${String(t.input.command).slice(0, 80)}` : ''}]`)
    const body = [m.text.trim(), ...tools].filter(Boolean).join('\n')
    if (body) lines.push(`${m.role === 'user' ? 'USER' : 'CLAUDE'}:\n${body}`)
  }
  const all = lines.join('\n\n')
  return all.length <= maxChars ? all : `[earlier turns cut for length]\n\n${all.slice(all.length - maxChars)}`
}

export const HANDOFF_SYSTEM =
  'You write handoff notes so a fresh Claude session can continue a piece of work exactly where an earlier conversation stood. Write plainly, in Markdown, with no preamble.'

export function handoffPrompt(transcript: string, waypoint: Waypoint): string {
  return [
    `Below is a conversation up to a point the user pinned as "${waypoint.name}". Write a handoff note for a new session that starts from that point.`,
    'Include, in this order: the goal; decisions made and why; the current state of the code or work (files, commands, results); open questions; and the next step the user was heading toward.',
    'Keep it under 600 words. Leave out anything that happened only as a dead end, unless the reason it failed matters.',
    '',
    '<conversation>',
    transcript,
    '</conversation>',
  ].join('\n')
}

/** The first message of a forked session: the note, framed so Claude knows what it is. */
export function forkOpening(fork: Fork): string {
  return [
    `This session continues from the waypoint "${fork.waypoint}" in an earlier conversation. Here is the handoff written at that point:`,
    '',
    fork.handoff.trim(),
    '',
    'Read it, confirm in two or three lines where we are, and wait for my next instruction.',
  ].join('\n')
}

/** A plain fallback note when the model cannot be reached: the last few turns, verbatim. */
export function fallbackHandoff(messages: readonly Message[], index: number): string {
  const tail = messages
    .slice(0, index + 1)
    .filter(m => m.text.trim())
    .slice(-6)
    .map(m => `**${m.role === 'user' ? 'Me' : 'Claude'}:** ${excerpt(m.text, 600)}`)
  return ['_The handoff summary could not be written, so here are the last turns before the waypoint:_', '', ...tail].join('\n\n')
}

export type { Fork, Waypoint }
