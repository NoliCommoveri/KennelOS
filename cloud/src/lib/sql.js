// Ported verbatim from MCCE_Coop_Learning (src/lib/sql.js). Keep it that way:
// a fix found in one copy belongs in both.
//
// Split a migration file into individual statements.
//
// D1's db.exec() splits on newlines and requires one statement per line, which
// our schema files are not. This splitter tracks string literals, quoted
// identifiers, and comments so a semicolon inside any of them does not end a
// statement, and it tracks BEGIN/CASE ... END nesting so a compound statement
// -- a trigger body is the one that matters -- stays whole.
export function splitStatements(sql) {
  const out = [];
  let buf = '';
  let i = 0;

  // Open BEGIN/CASE blocks. A ';' inside one belongs to the trigger body, not
  // to the migration, so it is not a terminator.
  let depth = 0;
  let word = '';

  // Called at every boundary between a word and anything else. BEGIN and CASE
  // both close with END, so counting them together keeps the depth balanced
  // whether the END belongs to a trigger body or to a CASE expression.
  const endWord = () => {
    if (!word) return;
    const w = word.toUpperCase();
    if (w === 'BEGIN' || w === 'CASE') depth++;
    else if (w === 'END' && depth > 0) depth--;
    word = '';
  };

  const isWordChar = (c) => c === '_' || c === '$' || (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');

  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];

    if (c === '-' && next === '-') {
      endWord();
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      endWord();
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      endWord();
      const quote = c;
      buf += c;
      i++;
      while (i < sql.length) {
        buf += sql[i];
        if (sql[i] === quote) {
          // '' and "" are escaped quotes, not the end of the literal.
          if (sql[i + 1] === quote) { buf += sql[i + 1]; i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '[') {
      // SQLite's other quoted-identifier form. Ends at the first ']'.
      endWord();
      buf += c;
      i++;
      while (i < sql.length && sql[i] !== ']') { buf += sql[i]; i++; }
      if (i < sql.length) { buf += ']'; i++; }
      continue;
    }
    if (c === ';') {
      // Close the word first: in `END;` the END is what drops the depth back
      // to zero, and it has to land before the ';' is judged.
      endWord();
      if (depth === 0) {
        if (buf.trim()) out.push(buf.trim());
        buf = '';
        i++;
        continue;
      }
      buf += c;
      i++;
      continue;
    }

    if (isWordChar(c)) word += c; else endWord();
    buf += c;
    i++;
  }

  endWord();
  if (buf.trim()) out.push(buf.trim());
  return out;
}
