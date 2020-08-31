/* global Actors, ActorSheet, Items, ItemSheet, ChatMessage, CONFIG, game, Hooks, Macro, ui, loadTemplates, Handlebars, EntitySheetConfig */
/**
 * DCC
 */

// Import Modules
import DCCActor from './actor.js'
import DCCActorSheet from './actor-sheet.js'
import * as DCCSheets from './actor-sheets-dcc.js'
import DCCItem from './item.js'
import DCCItemSheet from './item-sheet.js'
import DCC from './config.js'
import * as chat from './chat.js'

// Override the template for sheet configuration
class DCCSheetConfig extends EntitySheetConfig {
  /** @override */
  static get defaultOptions () {
    const options = super.defaultOptions
    options.template = 'systems/dcc/templates/sheet-config.html'
    options.tabs.unshift({ navSelector: '.config-tabs', contentSelector: '.config-body', initial: 'this-sheet' })
    return options
  }
}

/* -------------------------------------------- */
/*  Foundry VTT Initialization                  */
/* -------------------------------------------- */
Hooks.once('init', async function () {
  console.log(`DCC | Initializing Dungeon Crawl Classics System\n${DCC.ASCII}`)

  // Override sheet selection dialog
  EntitySheetConfig = DCCSheetConfig // eslint-disable-line no-global-assign

  CONFIG.DCC = DCC

  game.dcc = {
    DCCActor,
    rollDCCWeaponMacro, // This is called from macros, don't remove
    getMacroActor // This is called from macros, don't remove
  }

  // Define custom Entity classes
  CONFIG.Actor.entityClass = DCCActor
  CONFIG.Item.entityClass = DCCItem

  // Register sheet application classes
  Actors.unregisterSheet('core', ActorSheet)
  Actors.registerSheet('dcc', DCCActorSheet, { makeDefault: true })
  Actors.registerSheet('dcc', DCCSheets.DCCActorSheetCleric)
  Actors.registerSheet('dcc', DCCSheets.DCCActorSheetThief)
  Actors.registerSheet('dcc', DCCSheets.DCCActorSheetHalfling)
  Actors.registerSheet('dcc', DCCSheets.DCCActorSheetWarrior)
  Actors.registerSheet('dcc', DCCSheets.DCCActorSheetWizard)
  Actors.registerSheet('dcc', DCCSheets.DCCActorSheetDwarf)
  Actors.registerSheet('dcc', DCCSheets.DCCActorSheetElf)
  Items.unregisterSheet('core', ItemSheet)
  Items.registerSheet('dcc', DCCItemSheet)

  // Register shared template for upper level characters
  const templatePaths = [
    'systems/dcc/templates/actor-partial-pc-header.html',
    'systems/dcc/templates/actor-partial-pc-common.html',
    'systems/dcc/templates/actor-partial-pc-equipment.html',
    'systems/dcc/templates/actor-partial-pc-notes.html',
    'systems/dcc/templates/actor-partial-wizard-spells.html',
    'systems/dcc/templates/actor-partial-cleric-spells.html',
    'systems/dcc/templates/item-partial-header.html'
  ]
  loadTemplates(templatePaths)

  // Handlebars helper to format attack bonus correctly
  Handlebars.registerHelper('formatAttackBonus', function (attackBonus) {
    if (!attackBonus) {
      return '+0'
    } else if (attackBonus[0] !== '+' && attackBonus[0] !== '-') {
      return '+' + attackBonus
    }
    return attackBonus
  })

  // Handlebars helper to stringify JSON objects for debugging
  Handlebars.registerHelper('stringify', function (object) {
    return JSON.stringify(object)
  })

  // Register system settings
  game.settings.register('dcc', 'macroShorthand', {
    name: 'Shortened Macro Syntax',
    hint: 'Enable a shortened macro syntax which allows referencing attributes directly, for example @str instead of @attributes.str.value. Disable this setting if you need the ability to reference the full attribute model, for example @attributes.str.label.',
    scope: 'world',
    type: Boolean,
    default: true,
    config: true
  })
})

/* -------------------------------------------- */
/*  Other Hooks                                 */
/* -------------------------------------------- */
// Create a macro when a rollable is dropped on the hotbar
Hooks.on('hotbarDrop', (bar, data, slot) => createDCCMacro(data, slot))

// Highlight 1's and 20's for all regular rolls
Hooks.on('renderChatMessage', (app, html, data) => {
  chat.highlightCriticalSuccessFailure(app, html, data)
})

// Support context menu on chat cards
Hooks.on('getChatLogEntryContext', chat.addChatMessageContextOptions)

/* -------------------------------------------- */
/*  Hotbar Macros                               */

/* -------------------------------------------- */

/**
 * Create a Macro from a hotbar drop.
 * Dispatch to the appropriate function for the item type
 * @param {Object} data     The dropped data
 * @param {number} slot     The hotbar slot to use
 * @returns {Promise}
 */
async function createDCCMacro (data, slot) {
  const handlers = {
    Ability: _createDCCAbilityMacro,
    Initiative: _createDCCInitiativeMacro,
    Save: _createDCCSaveMacro,
    Skill: _createDCCSkillMacro,
    'Luck Die': _createDCCLuckDieMacro,
    'Spell Check': _createDCCSpellCheckMacro,
    'Attack Bonus': _createDCCAttackBonusMacro,
    Weapon: _createDCCWeaponMacro
  }
  if (!handlers[data.type]) return
  if (!('data' in data)) return ui.notifications.warn('You can only create macro buttons for owned items')

  // Call the appropriate function to generate a macro
  const macroData = handlers[data.type](data, slot)
  if (macroData) {
    // Create or reuse existing macro
    let macro = game.macros.entities.find(
      m => (m.name === macroData.name) && (m.command === macroData.command)
    )
    if (!macro) {
      macro = await Macro.create({
        name: macroData.name,
        type: 'script',
        img: macroData.img,
        command: macroData.command,
        flags: { 'dcc.itemMacro': true }
      })
    }
    await game.user.assignHotbarMacro(macro, slot)
  }
  return false
}

/**
 * Create a macro from an ability check drop.
 * @param {Object} data     The dropped data
 * @param {number} slot     The hotbar slot to use
 * @returns {Promise}
 */
function _createDCCAbilityMacro (data, slot) {
  if (data.type !== 'Ability') return

  // Create the macro command
  const abilityId = data.data.abilityId
  const rollUnder = data.data.rollUnder
  const macroData = {
    name: game.i18n.localize(CONFIG.DCC.abilities[abilityId]),
    command: `const actor = game.dcc.getMacroActor(); if (actor) { actor.rollAbilityCheck("${abilityId}", { rollUnder: ${rollUnder} } ) }`,
    img: '/systems/dcc/styles/images/critical.png'
  }

  // If this is a roll under check make it clear in the macro name
  if (rollUnder) {
    macroData.name = game.i18n.format('DCC.RollUnder', { name: macroData.name })
  }

  return macroData
}

/**
 * Create a macro from an initiative drop.
 * @param {Object} data     The dropped data
 * @param {number} slot     The hotbar slot to use
 * @returns {Promise}
 */
function _createDCCInitiativeMacro (data, slot) {
  if (data.type !== 'Initiative') return

  // Create the macro command
  const macroData = {
    name: game.i18n.localize('DCC.Initiative'),
    command: 'const actor = game.dcc.getMacroActor(); if (actor) { actor.rollInitiative() }',
    img: '/systems/dcc/styles/images/critical.png'
  }

  return macroData
}

/**
 * Create a macro from a saving throw drop.
 * @param {Object} data     The dropped data
 * @param {number} slot     The hotbar slot to use
 * @returns {Promise}
 */
function _createDCCSaveMacro (data, slot) {
  if (data.type !== 'Save') return

  // Create the macro command
  const saveId = data.data
  const macroData = {
    name: game.i18n.localize(CONFIG.DCC.saves[saveId]),
    command: `const actor = game.dcc.getMacroActor(); if (actor) { actor.rollSavingThrow("${saveId}") }`,
    img: '/systems/dcc/styles/images/critical.png'
  }

  return macroData
}

/**
 * Create a macro from a skill roll drop.
 * @param {Object} data     The dropped data
 * @param {number} slot     The hotbar slot to use
 * @returns {Promise}
 */
function _createDCCSkillMacro (data, slot) {
  if (data.type !== 'Skill') return

  // Create the macro command
  const skillId = data.data.skillId
  const skillName = game.i18n.localize(data.data.skillName)
  const macroData = {
    name: skillName,
    command: `const actor = game.dcc.getMacroActor(); if (actor) { actor.rollSkillCheck("${skillId}") }`,
    img: '/systems/dcc/styles/images/critical.png'
  }

  return macroData
}

/**
 * Create a macro from a luck die drop.
 * @param {Object} data     The dropped data
 * @param {number} slot     The hotbar slot to use
 * @returns {Promise}
 */
function _createDCCLuckDieMacro (data, slot) {
  if (data.type !== 'Luck Die') return

  // Create the macro command
  const macroData = {
    name: game.i18n.localize('DCC.LuckDie'),
    command: 'const actor = game.dcc.getMacroActor(); if (actor) { actor.rollLuckDie() }',
    img: '/systems/dcc/styles/images/critical.png'
  }

  return macroData
}

/**
 * Create a macro from a spell check drop.
 * @param {Object} data     The dropped data
 * @param {number} slot     The hotbar slot to use
 * @returns {Promise}
 */
function _createDCCSpellCheckMacro (data, slot) {
  if (data.type !== 'Spell Check') return

  // Create the macro command
  const abilityId = data.data.ability
  const spell = data.data.spell || null
  const macroData = {
    name: game.i18n.localize('DCC.SpellCheck'),
    command: `const actor = game.dcc.getMacroActor(); if (actor) { actor.rollSpellCheck("${abilityId}") }`,
    img: '/systems/dcc/styles/images/critical.png'
  }

  if (spell) {
    macroData.command = `const actor = game.dcc.getMacroActor(); if (actor) { actor.rollSpellCheck("${abilityId}", "${spell}") }`
  }

  return macroData
}

/**
 * Create a macro from an attack bonus drop.
 * @param {Object} data     The dropped data
 * @param {number} slot     The hotbar slot to use
 * @returns {Promise}
 */
function _createDCCAttackBonusMacro (data, slot) {
  if (data.type !== 'Attack Bonus') return

  // Create the macro command
  const macroData = {
    name: game.i18n.localize('DCC.AttackBonus'),
    command: 'const actor = game.dcc.getMacroActor(); if (actor) { actor.rollAttackBonus() }',
    img: '/systems/dcc/styles/images/critical.png'
  }

  return macroData
}

/**
 * Create a Macro from a weapon drop.
 * Get an existing macro if one exists, otherwise create a new one.
 * @param {Object} data     The dropped data
 * @param {number} slot     The hotbar slot to use
 * @returns {Promise}
 */
function _createDCCWeaponMacro (data, slot) {
  if (data.type !== 'Weapon') return
  const item = data.data

  const macroData = {
    name: item.name,
    command: `game.dcc.rollDCCWeaponMacro("${item.id}");`,
    img: '/systems/dcc/styles/images/axe-square.png'
  }

  if (item.id[0] === 'r') {
    macroData.img = '/systems/dcc/styles/images/bow-square.png'
  }

  return macroData
}

/**
 * Roll a weapon attack from a macro.
 * @param {string} itemId
 * @return {Promise}
 */
function rollDCCWeaponMacro (itemId) {
  const speaker = ChatMessage.getSpeaker()
  let actor
  if (speaker.token) actor = game.actors.tokens[speaker.token]
  if (!actor) actor = game.actors.get(speaker.actor)
  if (!actor) return ui.notifications.warn('You must select a token to run this macro.')

  // Trigger the weapon roll
  return actor.rollWeaponAttack(itemId)
}

/**
 * Get the current actor - for use in macros
 * @return {Promise}
 */
function getMacroActor () {
  const speaker = ChatMessage.getSpeaker()
  let actor
  if (speaker.token) actor = game.actors.tokens[speaker.token]
  if (!actor) actor = game.actors.get(speaker.actor)
  if (!actor) return ui.notifications.warn('You must select a token to run this macro.')

  // Return the actor if found
  return actor
}
