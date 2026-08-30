// Tiny safe evaluator for YNAB-style amount fields: numbers combined with
// + - * / and parentheses, evaluated with normal precedence (PEMDAS). A
// leading operator applies to the field's current value, so "+200" adds and
// "-.37" subtracts from what's there. Strips $ signs, commas, and spaces.
// Returns null when the input isn't a valid expression; never throws and
// never uses eval.
export function evaluateAmountExpression (raw: string, currentValue: number): number | null {
  let source = raw.replace(/[$,\s]/g, '')
  if (!source) return null
  if (/^[+\-*/]/.test(source)) source = `(${currentValue})${source}`

  let pos = 0

  const peek = () => source[pos]

  const parseNumber = (): number | null => {
    const match = /^\d*\.?\d+/.exec(source.slice(pos))
    if (!match) return null
    pos += match[0].length
    return Number.parseFloat(match[0])
  }

  const parseFactor = (): number | null => {
    if (peek() === '-') {
      pos++
      const value = parseFactor()
      return value === null ? null : -value
    }
    if (peek() === '+') {
      pos++
      return parseFactor()
    }
    if (peek() === '(') {
      pos++
      const value = parseExpression()
      if (value === null || peek() !== ')') return null
      pos++
      return value
    }
    return parseNumber()
  }

  const parseTerm = (): number | null => {
    let value = parseFactor()
    while (value !== null && (peek() === '*' || peek() === '/')) {
      const op = source[pos++]
      const rhs = parseFactor()
      if (rhs === null) return null
      value = op === '*' ? value * rhs : value / rhs
    }
    return value
  }

  const parseExpression = (): number | null => {
    let value = parseTerm()
    while (value !== null && (peek() === '+' || peek() === '-')) {
      const op = source[pos++]
      const rhs = parseTerm()
      if (rhs === null) return null
      value = op === '+' ? value + rhs : value - rhs
    }
    return value
  }

  const result = parseExpression()
  if (result === null || pos !== source.length || !Number.isFinite(result)) return null
  return result
}
