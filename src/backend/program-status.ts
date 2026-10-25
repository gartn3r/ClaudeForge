// The OSC 7501 Program Status Protocol (rev 0.4, https://www.superlogical.com/rex/docs/build/program-status),
// as Claude Code 2.1.295 and later speaks it to the terminal it runs in: it asks whether the terminal
// reads status reports (`OSC 7501 ; ? ST`), then reports its state (`OSC 7501 ; state=working:app=claude-code ST`).

/** The terminal's answer to the support probe: it reads every state and every kind of block. */
export const PROBE_REPLY = '\x1b]7501;?:states=idle,working,done,blocked,error:kinds=permission,question,auth\x1b\\'

export type ProgramStatusState = 'idle' | 'working' | 'done' | 'blocked' | 'error' | 'clear'

/** What a program said about its status: it asked whether the terminal reads reports, or reported a state. */
export type ProgramStatusSignal = { kind: 'probe' } | { kind: 'report'; state: ProgramStatusState }

const START = '\x1b]7501;'
// Either string terminator ends a sequence, BEL or ESC \.
// eslint-disable-next-line no-control-regex -- the sequences start with ESC and end with BEL or ESC
const SEQUENCE = /\x1b\]7501;([^\x07\x1b]*)(?:\x07|\x1b\\)/g
/** The protocol caps a whole sequence at 4096 bytes. */
const MAX_SEQUENCE = 4096
const STATES = new Set<string>(['idle', 'working', 'done', 'blocked', 'error', 'clear'])

/** The signal one sequence's body holds; null for a report the reader ignores. */
function signalOf(body: string): ProgramStatusSignal | null {
  if (body === '?') return { kind: 'probe' }
  // `key=value` pairs joined by `:`; when a key repeats, the last value wins.
  const pairs = new Map(
    body.split(':').map((pair) => {
      const equals = pair.indexOf('=')
      return equals < 0 ? [pair, ''] : [pair.slice(0, equals), pair.slice(equals + 1)]
    })
  )
  const state = pairs.get('state')
  // A report with an id is about a part of the program's work (a record beneath its own): not its status.
  if (!state || !STATES.has(state) || pairs.has('id')) return null
  return { kind: 'report', state: state as ProgramStatusState }
}

/** Reads the status signals in a program's output, chunk by chunk, wherever the chunks split a sequence. */
export class ProgramStatusReader {
  /** The start of a sequence the last chunk cut short. */
  private carry = ''

  read(data: string): ProgramStatusSignal[] {
    const text = this.carry + data
    const signals: ProgramStatusSignal[] = []
    let end = 0
    for (const match of text.matchAll(SEQUENCE)) {
      const signal = signalOf(match[1]!)
      if (signal) signals.push(signal)
      end = match.index + match[0].length
    }
    const rest = text.slice(end)
    const open = rest.lastIndexOf(START)
    if (open >= 0) {
      this.carry = rest.length - open <= MAX_SEQUENCE ? rest.slice(open) : ''
    } else {
      // The chunk may end inside the sequence's introducer itself.
      let length = Math.min(rest.length, START.length - 1)
      while (length > 0 && !START.startsWith(rest.slice(-length))) length--
      this.carry = length > 0 ? rest.slice(-length) : ''
    }
    return signals
  }
}
