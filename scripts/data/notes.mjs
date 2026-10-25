/**
 * The notes investigators leave on a clue.
 *
 * A note has no id of its own — the schema is `{author, text, time, edited}` — so one is named by
 * who wrote it and when. That pair survives what an array index does not: someone else adding or
 * deleting a note between the inspector being drawn and the click landing would shift every index
 * after it, and the wrong note would change. Editing keeps `time` as it was for the same reason.
 */

/**
 * Whether a user may edit or delete a note: the GM any note, a player only their own.
 *
 * The change is written back through the clue page, so the caller still needs to own the page;
 * this only answers whose note it is.
 *
 * @param {{author: string}} note
 * @param {User} [user]
 * @returns {boolean}
 */
export function canChangeNote(note, user = game.user) {
  if ( !note || !user ) return false;
  return !!user.isGM || note.author === user.id;
}

/* -------------------------------------------- */

/**
 * Where a note sits in the list, by author and time.
 * @param {{author: string, time: number}[]} notes
 * @param {{author: string, time: number}} target
 * @returns {number}   -1 when it is no longer there.
 */
function indexOfNote(notes, {author, time}) {
  return (notes ?? []).findIndex(n => n.author === author && n.time === time);
}

/* -------------------------------------------- */

/**
 * The notes with one taken out.
 *
 * Returns null when the note is no longer there — already deleted elsewhere — so the caller can
 * skip writing an unchanged array back.
 *
 * @param {{author: string, time: number}[]} notes
 * @param {{author: string, time: number}} target
 * @returns {object[]|null}
 */
export function withoutNote(notes, target) {
  const index = indexOfNote(notes, target);
  if ( index === -1 ) return null;
  return notes.filter((_n, i) => i !== index);
}

/* -------------------------------------------- */

/**
 * The notes with one rewritten.
 *
 * The author and time stay as they were — they are the note's name, and the byline should still
 * say who wrote it first — and `edited` records when it changed. Null when the note is gone or the
 * text is unchanged, so nothing is written back.
 *
 * @param {{author: string, time: number, text: string}[]} notes
 * @param {{author: string, time: number}} target
 * @param {string} text
 * @param {number} [now]
 * @returns {object[]|null}
 */
export function withNoteText(notes, target, text, now = Date.now()) {
  const index = indexOfNote(notes, target);
  if ( (index === -1) || (notes[index].text === text) ) return null;
  return notes.map((n, i) => (i === index ? {...n, text, edited: now} : n));
}
