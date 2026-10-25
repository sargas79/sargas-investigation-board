import fs from "node:fs";
import path from "node:path";
import {assert, check, describe} from "./harness.mjs";

const ROOT = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");

/**
 * Checks for the notes left on a clue: who may delete one (#83), that deleting takes out the note
 * that was clicked and no other, and that adding one no longer locks the rest of Foundry (#82).
 */
export default async function testNotes() {
  const {canChangeNote, withNoteText, withoutNote} = await import("../scripts/data/notes.mjs");
  const app = read("scripts/apps/investigation-board.mjs");
  const inspector = read("templates/inspector.hbs");

  const gm = {id: "gm", isGM: true};
  const mara = {id: "p1", isGM: false};
  const silas = {id: "p2", isGM: false};
  const notes = [
    {author: "p1", text: "Alibi doesn't hold.", time: 100},
    {author: "p2", text: "Saw him at the docks.", time: 200},
    {author: "p1", text: "Check the ledger.", time: 300}
  ];

  describe("canChangeNote");

  await check("a player may delete their own note and nobody else's", () => {
    assert(canChangeNote(notes[0], mara) === true, "a player was refused their own note");
    assert(canChangeNote(notes[1], mara) === false, "a player was allowed someone else's note");
  });

  await check("the GM may delete any note", () => {
    assert(notes.every(n => canChangeNote(n, gm)), "the GM was refused a note");
  });

  await check("a missing user or note is refused rather than throwing", () => {
    assert(canChangeNote(notes[0], null) === false, "nobody was allowed to change a note");
    assert(canChangeNote(null, gm) === false, "a missing note was changeable");
  });

  describe("withoutNote");

  await check("takes out the note named by author and time, and only that one", () => {
    const left = withoutNote(notes, {author: "p1", time: 300});
    assert(left.length === 2, `kept ${left.length} notes, expected 2`);
    assert(left.every(n => n.time !== 300), "the named note survived");
    assert(left[0] === notes[0] && left[1] === notes[1], "the other notes were disturbed");
  });

  // The reason notes are named rather than indexed: the list may have moved under the click.
  await check("still finds the note after the list has shifted", () => {
    const shifted = [notes[1], notes[2]];
    const left = withoutNote(shifted, {author: "p1", time: 300});
    assert(left.length === 1 && left[0] === notes[1], "the wrong note was taken out");
  });

  await check("a note already gone yields null, so nothing is written back", () => {
    assert(withoutNote(notes, {author: "p2", time: 999}) === null, "a missing note was 'deleted'");
    assert(withoutNote(undefined, {author: "p1", time: 100}) === null, "no notes threw or deleted");
  });

  await check("does not modify the array it was given", () => {
    const copy = notes.slice();
    withoutNote(copy, {author: "p1", time: 100});
    assert(copy.length === 3, "the original array was changed");
  });

  describe("withNoteText");

  await check("rewrites the named note and keeps who wrote it and when", () => {
    const after = withNoteText(notes, {author: "p2", time: 200}, "Saw him at the warehouse.", 500);
    assert(after[1].text === "Saw him at the warehouse.", "the text was not changed");
    assert(after[1].author === "p2" && after[1].time === 200, "the note's author or time changed");
    assert(after[1].edited === 500, "the edit was not recorded");
    assert(after[0] === notes[0] && after[2] === notes[2], "the other notes were disturbed");
    assert(notes[1].text === "Saw him at the docks.", "the original array was changed");
  });

  await check("an unchanged or missing note yields null, so nothing is written back", () => {
    assert(withNoteText(notes, {author: "p1", time: 100}, "Alibi doesn't hold.") === null,
      "an unchanged note was written back");
    assert(withNoteText(notes, {author: "p1", time: 999}, "x") === null, "a missing note was 'edited'");
  });

  describe("note controls");

  await check("the inspector offers an edit control, gated per note", () => {
    assert(app.includes("editNote: InvestigationBoard.#onEditNote"), "no editNote action is registered");
    const index = inspector.indexOf('data-action="editNote"');
    assert(index !== -1, "no control invokes editNote");
    const preceding = inspector.slice(0, index);
    assert(/\{\{#if this\.canChange\}\}/.test(preceding.slice(preceding.lastIndexOf("{{#if"))),
      "the edit control is not gated on canChange");
  });

  await check("the Edit Note prompt does not lock the rest of Foundry either", () => {
    const start = app.indexOf("static async #onEditNote(");
    const body = app.slice(start, app.indexOf("static async", start + 1));
    assert(start !== -1, "#onEditNote not found");
    assert(!/modal:\s*true/.test(body), "the Edit Note prompt is modal");
    assert(/escapeHTML/.test(body), "the note's text is put into the prompt unescaped");
  });

  await check("the inspector offers a delete control, gated per note", () => {
    assert(app.includes("deleteNote: InvestigationBoard.#onDeleteNote"), "no deleteNote action is registered");
    const index = inspector.indexOf('data-action="deleteNote"');
    assert(index !== -1, "no control invokes deleteNote");
    const preceding = inspector.slice(0, index);
    assert(/\{\{#if this.canChange\}\}/.test(preceding.slice(preceding.lastIndexOf("{{#if"))),
      "the delete control is not gated on canChange");
  });

  // #82: a note is often copied out of a journal or the chat, which a modal prompt forbids.
  await check("the Add Note prompt does not lock the rest of Foundry", () => {
    const start = app.indexOf("static async #onAddNote()");
    const end = app.indexOf("static async", start + 1);
    const body = app.slice(start, end);
    assert(start !== -1, "#onAddNote not found");
    assert(!/modal:\s*true/.test(body), "the Add Note prompt is still modal");
    assert(/bringToFront/.test(body), "a second click opens a duplicate prompt instead of raising the first");
  });
}
