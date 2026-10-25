import {
  CLUE_DEFAULTS,
  HANDOUT_CLUE_TEMPLATES,
  HANDOUT_FLAGS,
  HANDOUT_KINDS,
  MODULE_ID,
  PAGE_TYPES
} from "../constants.mjs";
import {authorStamp} from "./authorship.mjs";
import {inCasesFolder} from "./folders.mjs";
import {freeSpotNear, getCases, topZ} from "./case.mjs";

/**
 * Handouts: documents the GM writes in advance and hands over when the moment comes.
 *
 * **A handout is a JournalEntry of its own**, flagged as one, holding a single page of sub-type
 * `sargas-investigation-board.handout`. Nothing cheaper would work. Foundry only enforces ownership on
 * top-level documents: a page inside an entry a player can already see is filtered from the
 * *display* but still sits in their client, readable from the console. `data/redaction.mjs` was
 * written around the same limit and reaches the same conclusion — if a player must not read
 * something, the thing must be a document they were never sent.
 *
 * So an unshared handout has `ownership.default = NONE` and no entry for anyone but the GMs, and a
 * player's client simply never receives it. That in turn is why listing handouts for a player needs
 * no permission filtering at all: the list is everything they hold, and they hold exactly what has
 * been shared with them.
 *
 * Writing handouts is the GM's alone. Sharing one grants **Observer**, not Owner — a player reads
 * the document and works from it; they do not get to rewrite the coroner's report or delete it.
 * What a player *can* do is pin it to a case, which makes an ordinary clue card pointing at the
 * handout and leaves the document itself untouched.
 */

/**
 * Whether a journal entry is a handout.
 * @param {JournalEntry} journal
 * @returns {boolean}
 */
export function isHandout(journal) {
  return !!journal?.getFlag(MODULE_ID, HANDOUT_FLAGS.IS_HANDOUT);
}

/* -------------------------------------------- */

/**
 * Whether this user may write and hand over documents.
 *
 * True for Assistant GMs as well: `isGM` covers both, and the server treats them alike for the
 * ownership changes that sharing is made of.
 * @param {User} [user]
 * @returns {boolean}
 */
export function canManageHandouts(user = game.user) {
  return !!user?.isGM;
}

/* -------------------------------------------- */

/**
 * The page carrying a handout's content.
 *
 * A handout has exactly one, created with it. The `find` rather than an index guards against an
 * entry someone has added a stray page to by hand.
 *
 * @param {JournalEntry} journal
 * @returns {JournalEntryPage|undefined}
 */
export function handoutPage(journal) {
  return journal?.pages.find(p => p.type === PAGE_TYPES.HANDOUT);
}

/* -------------------------------------------- */

/**
 * Every handout this user holds, in name order.
 *
 * For a GM that is all of them; for a player it is the ones shared with them, and nothing filters
 * that — see the module note. `visible` is belt-and-braces for a handout a GM has explicitly set
 * to Limited on themselves.
 *
 * @returns {JournalEntry[]}
 */
export function getHandouts(caseJournal = null) {
  // Read once rather than per handout: deciding where an unassigned one belongs looks at them all.
  const cases = caseJournal ? getCases({includeArchived: true}) : [];
  return game.journal
    .filter(j => isHandout(j) && j.visible)
    .filter(j => !caseJournal || belongsToCase(j, caseJournal, cases))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* -------------------------------------------- */

/**
 * The id of the case a handout was written for, or null.
 * @param {JournalEntry} journal
 * @returns {string|null}
 */
export function handoutCaseId(journal) {
  return journal?.getFlag(MODULE_ID, HANDOUT_FLAGS.CASE_ID) || null;
}

/* -------------------------------------------- */

/**
 * Whether a case has a card pinned from this handout, set aside or not.
 * @param {JournalEntry} journal
 * @param {JournalEntry} caseJournal
 * @returns {boolean}
 */
export function isPinnedIn(journal, caseJournal) {
  return !!caseJournal?.pages.some(p =>
    (p.type === PAGE_TYPES.CLUE) && (p.system.linkedUuid === journal.uuid));
}

/* -------------------------------------------- */

/**
 * Whether a handout belongs in a case's documents list (#84).
 *
 * The case it was written for, and any case it has been pinned to — a document pinned to a second
 * investigation is evidence there too. A handout written before handouts recorded a case is placed
 * by where it has been pinned, and one pinned nowhere shows under every case: hiding it would leave
 * a document nobody could find again. For the same reason a handout filed under a case that is gone
 * — deleted, or one this user cannot see — is treated as unassigned.
 *
 * @param {JournalEntry} journal
 * @param {JournalEntry} caseJournal
 * @param {JournalEntry[]} [cases]     Every case, to place an unassigned handout by its pins.
 * @returns {boolean}
 */
export function belongsToCase(journal, caseJournal, cases = getCases({includeArchived: true})) {
  if ( isPinnedIn(journal, caseJournal) ) return true;
  const assigned = handoutCaseId(journal);
  if ( assigned && cases.some(c => c.id === assigned) ) return assigned === caseJournal.id;
  return !cases.some(c => isPinnedIn(journal, c));
}

/* -------------------------------------------- */

/**
 * The blanks a newly created handout of a given kind starts with.
 *
 * Localized here rather than stored as keys, because once a GM has typed into a row the label is
 * theirs — a later language change must not overwrite what they wrote.
 *
 * @param {string} kind
 * @returns {{label: string, value: string}[]}
 */
export function seedRows(kind) {
  const config = HANDOUT_KINDS[kind] ?? HANDOUT_KINDS.document;
  return config.fields.map(key => ({label: game.i18n.localize(key), value: ""}));
}

/* -------------------------------------------- */

/**
 * The ownership map for a handout shared with the given users.
 *
 * Distinct from the case equivalent in `data/sharing.mjs` on both counts that matter: a handout has
 * no assigned player to protect, and what it grants is Observer rather than Owner.
 *
 * @param {object} options
 * @param {string[]} [options.userIds]     Players who should be able to read it.
 * @param {boolean} [options.wholeParty]   Hand it to everyone rather than named players.
 * @returns {object}
 */
export function handoutOwnership({userIds = [], wholeParty = false} = {}) {
  const levels = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  // Observer, not Owner: enough to read the document, never enough to change or destroy it.
  const granted = levels.OBSERVER;
  const ownership = {default: wholeParty ? granted : levels.NONE};

  if ( !wholeParty ) {
    for ( const id of userIds ) ownership[id] = granted;
  }

  // Every GM keeps the document outright: they wrote it, and they are the only ones who can
  // un-share it again.
  for ( const user of game.users ) {
    if ( user.isGM ) ownership[user.id] = levels.OWNER;
  }

  return ownership;
}

/* -------------------------------------------- */

/**
 * Who a handout is currently in the hands of.
 * @param {JournalEntry} journal
 * @returns {{wholeParty: boolean, userIds: Set<string>}}
 */
export function currentHolders(journal) {
  const levels = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  const ownership = journal?.ownership ?? {};
  return {
    wholeParty: (ownership.default ?? levels.NONE) >= levels.OBSERVER,
    userIds: new Set(Object.entries(ownership)
      .filter(([id, level]) => {
        if ( id === "default" ) return false;
        if ( level < levels.OBSERVER ) return false;
        // A GM's own entry is bookkeeping, not a hand-over, and listing it would suggest the
        // document had been given to someone.
        return !game.users.get(id)?.isGM;
      })
      .map(([id]) => id))
  };
}

/* -------------------------------------------- */

/**
 * Write a new document. Created in the GM's hands alone; sharing it is a separate, later decision.
 *
 * @param {object} data
 * @param {string} data.name               What the document is called in the list.
 * @param {string} [data.kind]             One of `HANDOUT_KINDS`.
 * @param {object} [data.system]           Content for the handout page.
 * @param {string|null} [data.caseId]      The case it is written for; none shows it under every case.
 * @returns {Promise<JournalEntry|null>}
 */
export async function createHandout({name, kind = "document", system = {}, caseId = null} = {}) {
  if ( !canManageHandouts() ) {
    ui.notifications.warn("INVESTIGATION_BOARD.NOTIFY.HandoutIsGMOnly", {localize: true});
    return null;
  }

  const title = name?.trim() || game.i18n.localize("INVESTIGATION_BOARD.UntitledHandout");

  return JournalEntry.create(await inCasesFolder({
    name: title,
    // The point of the whole feature: nobody has this until the GM says so.
    ownership: {default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE},
    flags: {[MODULE_ID]: {[HANDOUT_FLAGS.IS_HANDOUT]: true, [HANDOUT_FLAGS.CASE_ID]: caseId || null}},
    pages: [{
      name: title,
      type: PAGE_TYPES.HANDOUT,
      system: {
        kind,
        rows: seedRows(kind),
        ...system,
        ...authorStamp(),
        createdAt: Date.now()
      }
    }]
  }));
}

/* -------------------------------------------- */

/**
 * Hand a document to players, or take it back.
 *
 * Both directions are this one call: sharing with nobody is how a handout is withdrawn, and the
 * player's client drops the document as soon as the update lands.
 *
 * Withdrawing does not chase down copies. A clue already pinned to a board keeps the name and
 * picture it was pinned with — it was a card the party made, not a window onto the document — and
 * only the link back to the handout stops resolving. That is the same thing that happens to any
 * clue whose linked document goes away.
 *
 * @param {JournalEntry} journal
 * @param {{userIds?: string[], wholeParty?: boolean}} options
 * @returns {Promise<boolean>}   Whether the change was applied.
 */
export async function shareHandout(journal, {userIds = [], wholeParty = false} = {}) {
  if ( !canManageHandouts() ) {
    ui.notifications.warn("INVESTIGATION_BOARD.NOTIFY.HandoutIsGMOnly", {localize: true});
    return false;
  }
  if ( !isHandout(journal) ) return false;

  const ids = userIds.filter(id => game.users.has(id));
  await journal.update({ownership: handoutOwnership({userIds: ids, wholeParty})});
  return true;
}

/* -------------------------------------------- */

/**
 * Whether a handout has reached anyone at all.
 * @param {JournalEntry} journal
 * @returns {boolean}
 */
export function isShared(journal) {
  const {wholeParty, userIds} = currentHolders(journal);
  return wholeParty || (userIds.size > 0);
}

/* -------------------------------------------- */

/**
 * How a handout looks as a clue card.
 *
 * The card copies how the document *looked* at the moment it went up — its name and picture — and
 * carries a `linkedUuid` to the handout, exactly as a dropped Actor or Item does. None of the
 * document's contents are copied into the case, so a player pinning a document they were handed
 * does not thereby publish it to everyone else the case is shared with: the others get a card
 * saying such a paper exists, and reading it still takes having been given it.
 *
 * The link is to the *entry*, not the page, because the entry is what ownership hangs off.
 *
 * Shared by the two ways a handout reaches a board — the pin button and a drag onto the cork — so
 * the card is the same object however it got there.
 *
 * @param {JournalEntry} journal
 * @returns {{name: string, system: object}|null}
 */
export function handoutClueData(journal) {
  const page = handoutPage(journal);
  if ( !page ) return null;

  const config = HANDOUT_CLUE_TEMPLATES[page.system.kind] ?? HANDOUT_CLUE_TEMPLATES.document;
  const image = page.system.image || null;
  return {
    name: journal.name,
    system: {
      // A card style that wants a picture but has none reads as a broken frame, so fall back.
      template: image ? config.template : "document",
      category: config.category,
      reliability: "unverified",
      pinColor: "red",
      image,
      body: "",
      linkedUuid: journal.uuid
    }
  };
}

/* -------------------------------------------- */

/**
 * Pin a handout to a case, as a clue card pointing back at the document.
 *
 * @param {JournalEntry} journal                The handout.
 * @param {JournalEntry} caseJournal            The case to pin it to.
 * @param {{x: number, y: number}} [center]     Where on the board, in board coordinates.
 * @returns {Promise<JournalEntryPage|null>}
 */
export async function pinHandout(journal, caseJournal, center = {x: 0, y: 0}) {
  const clue = handoutClueData(journal);
  if ( !clue || !caseJournal?.isOwner ) {
    ui.notifications.warn("INVESTIGATION_BOARD.NOTIFY.NoPermission", {localize: true});
    return null;
  }

  const spot = freeSpotNear(caseJournal, center);
  const [page] = await caseJournal.createEmbeddedDocuments("JournalEntryPage", [{
    name: clue.name,
    type: PAGE_TYPES.CLUE,
    system: {
      ...clue.system,
      ...authorStamp(),
      createdAt: Date.now(),
      x: spot.x,
      y: spot.y,
      z: topZ(caseJournal) + 1,
      width: CLUE_DEFAULTS.width,
      rotation: Math.round(((Math.random() * 8) - 4) * 10) / 10
    }
  }]);
  return page ?? null;
}
