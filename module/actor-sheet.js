/* global ActorSheet, CONFIG, duplicate, Dialog, game, mergeObject, $, ENTITY_PERMISSIONS */

import parsePC from './pc-parser.js'
import parseNPC from './npc-parser.js'
import DCCActorConfig from './actor-config.js'

/**
 * Extend the basic ActorSheet
 * @extends {ActorSheet}
 */
class DCCActorSheet extends ActorSheet {
  /** @override */
  static get defaultOptions () {
    return mergeObject(super.defaultOptions, {
      classes: ['dcc', 'sheet', 'actor'],
      template: 'systems/dcc/templates/actor-sheet-zero-level.html',
      width: 600,
      height: 600,
      tabs: [{ navSelector: '.sheet-tabs', contentSelector: '.sheet-body', initial: 'description' }],
      dragDrop: [{ dragSelector: '.weapon-list .weapon', dropSelector: null }]
    })
  }

  /** @inheritdoc */
  _getHeaderButtons () {
    const buttons = super._getHeaderButtons()

    // Header buttons shown only with Owner permissions
    if (this.actor.permission === ENTITY_PERMISSIONS.OWNER) {
      buttons.unshift(
        {
          label: game.i18n.localize('DCC.ConfigureSheet'),
          class: 'configure-actor',
          icon: 'fas fa-code',
          onclick: ev => this._onConfigureActor(ev)
        },
        {
          label: game.i18n.localize('DCC.ImportStats'),
          class: 'paste-block',
          icon: 'fas fa-paste',
          onclick: ev => this._onPasteStatBlock(ev)
        },
        {
          label: game.i18n.localize('DCC.Clear'),
          class: 'clear-sheet',
          icon: 'fas fa-eraser',
          onclick: ev => this._onClearSheet(ev)
        }
      )
    }

    return buttons
  }

  /* -------------------------------------------- */

  /** @override */
  getData () {
    // Basic data
    const isOwner = this.entity.owner
    const data = {
      owner: isOwner,
      limited: this.entity.limited,
      options: this.options,
      editable: this.isEditable,
      cssClass: isOwner ? 'editable' : 'locked',
      isNPC: this.entity.data.type === 'NPC',
      izPC: this.entity.data.type === 'Player',
      isZero: this.entity.data.data.details.level === 0,
      type: this.entity.data.type,
      config: CONFIG.DCC
    }

    data.actor = duplicate(this.actor.data)
    data.data = data.actor.data
    data.labels = this.actor.labels || {}
    data.filters = this._filters

    data.data.utility = {}
    data.data.utility.meleeWeapons = [0, 1, 2]
    data.data.utility.rangedWeapons = [3, 4]
    // console.log(data.data);

    if (data.isNPC) {
      this.options.template = 'systems/dcc/templates/actor-sheet-npc.html'
    } else {
      this.options.template = 'systems/dcc/templates/actor-sheet-zero-level.html'
    }

    // Prepare item lists by type
    this._prepareItems(data)

    return data
  }

  /**
   * Organize and classify Items for Character sheets.
   *
   * @param {Object} actorData The actor to prepare.
   * @return {undefined}
   */
  _prepareItems (sheetData) {
    const actorData = sheetData.actor

    // Initialize containers.
    const equipment = []
    const weapons = {
      melee: [],
      ranged: []
    }
    const armor = []
    const ammunition = []
    const mounts = []
    const spells = {
      1: [],
      2: [],
      3: [],
      4: [],
      5: []
    }
    const treasure = []
    const coins = []

    let inventory = actorData.items
    if (sheetData.data.config.sortInventory) {
      // Shallow copy and lexical sort
      inventory = [...inventory].sort((a, b) => a.name.localeCompare(b.name))
    }

    // Migrate any legacy weapons
    if (sheetData.data.items.weapons) {
      // Remove the legacy data first to avoid duplicating items when item creation triggers additional updates
      this.actor.update({ data: { items: { weapons: null } } })
      this._migrateWeapon(sheetData.data.items.weapons.m1, false)
      this._migrateWeapon(sheetData.data.items.weapons.m2, false)
      this._migrateWeapon(sheetData.data.items.weapons.r1, true)
      this._migrateWeapon(sheetData.data.items.weapons.r2, true)
    }

    // ... and armor
    if (sheetData.data.items.armor) {
      // Remove the legacy data first to avoid duplicating items when item creation triggers additional updates
      this.actor.update({ data: { items: { armor: null } } })
      this._migrateArmor(sheetData.data.items.armor.a0)
    }

    // Iterate through items, allocating to containers
    const removeEmptyItems = sheetData.data.config.removeEmptyItems
    for (const i of inventory) {
      // Remove physical items with zero quantity
      if (removeEmptyItems && i.data.quantity !== undefined && i.data.quantity <= 0) {
        this.actor.deleteOwnedItem(i._id, {})
        continue
      }

      if (i.type === 'weapon') {
        if (i.data.melee) {
          weapons.melee.push(i)
        } else {
          weapons.ranged.push(i)
        }
      } if (i.type === 'ammunition') {
        ammunition.push(i)
      } else if (i.type === 'armor') {
        armor.push(i)
      } else if (i.type === 'equipment') {
        equipment.push(i)
      } else if (i.type === 'mount') {
        mounts.push(i)
      } else if (i.type === 'spell') {
        if (i.data.level !== undefined) {
          spells[i.data.level].push(i)
        }
      } else if (i.type === 'treasure') {
        if (i.data.isCoins) {
          coins.push(i)
        } else {
          treasure.push(i)
        }
      }
    }

    // Combine any coins into a single item
    if (coins.length) {
      const wallet = coins.shift()
      for (const c of coins) {
        wallet.data.value.gp += c.data.value.gp
        wallet.data.value.sp += c.data.value.sp
        wallet.data.value.cp += c.data.value.cp
        this.actor.deleteOwnedItem(c._id, {})
      }
      this.actor.updateOwnedItem(wallet, { diff: true })
      treasure.push(wallet)
    }

    // Assign and return
    actorData.equipment = equipment
    actorData.weapons = weapons
    actorData.armor = armor
    actorData.ammunition = ammunition
    actorData.mounts = mounts
    actorData.spells = spells
    actorData.treasure = treasure
  }

  /**
   * Create an embedded object from a legacy weapon object
   *
   * @param {Object} weapon   The legacy weapon object.
   * @param {Object} ranged   Indicate that a ranged weapon should be created.
   * @return {Object}         The newly created item
   */
  _migrateWeapon (weapon, ranged = false) {
    if (!weapon.name) { return }
    const weaponData = {
      name: weapon.name,
      type: 'weapon',
      data: {
        toHit: weapon.toHit,
        damage: weapon.damage,
        range: weapon.range,
        melee: !ranged,
        description: {
          value: weapon.notes
        }
      }
    }

    // Create and return an equivalent item
    return this.actor.createOwnedItem(weaponData)
  }

  /**
   * Create an embedded object from a legacy armor object
   *
   * @param {Object} armor    The legacy armor object.
   * @return {Object}         The newly created item
   */
  _migrateArmor (armor) {
    if (!armor.name) { return }
    const armorData = {
      name: armor.name,
      type: 'armor',
      data: {
        acBonus: armor.bonus,
        checkPenalty: armor.checkPenalty,
        speed: '+0',
        fumbleDie: armor.fumbleDie,
        description: {
          value: armor.notes
        },
        quantity: 1,
        weight: 0,
        equipped: true,
        identified: true,
        value: {
          gp: 0,
          sp: 0,
          cp: 0
        }
      }
    }

    // Create and return an equivalent item
    return this.actor.createOwnedItem(armorData)
  }

  /* -------------------------------------------- */

  /** @override */
  activateListeners (html) {
    super.activateListeners(html)

    // Everything below here is only needed if the sheet is editable
    if (!this.options.editable) return

    // Drag event handler
    const dragHandler = ev => this._onDragStart(ev)

    // Owner Only Listeners
    if (this.actor.owner) {
      // Ability Checks
      html.find('.ability-name').click(this._onRollAbilityCheck.bind(this))
      html.find('.ability-modifiers').click(this._onRollAbilityCheck.bind(this))
      html.find('li.ability').each((i, li) => {
        // Add draggable attribute and dragstart listener.
        li.setAttribute('draggable', true)
        li.addEventListener('dragstart', dragHandler, false)
      })
      html.find('div.ability-modifiers').each((i, li) => {
        // Also make the luck modifier draggable for non-standard luck checks
        if (li.parentElement.dataset.ability === 'lck') {
          li.setAttribute('draggable', true)
          li.addEventListener('dragstart', dragHandler, false)
        }
      })

      // Initiative
      html.find('.init-label').click(this._onRollInitiative.bind(this))
      html.find('div.init').each((i, li) => {
        // Add draggable attribute and dragstart listener.
        li.setAttribute('draggable', true)
        li.addEventListener('dragstart', dragHandler, false)
      })

      // Saving Throws
      html.find('.save-name').click(this._onRollSavingThrow.bind(this))
      html.find('li.save').each((i, li) => {
        // Add draggable attribute and dragstart listener.
        li.setAttribute('draggable', true)
        li.addEventListener('dragstart', dragHandler, false)
      })

      // Skills
      html.find('.skill-check').click(this._onRollSkillCheck.bind(this))
      html.find('label.skill-check').each((i, li) => {
        // Add draggable attribute and dragstart listener.
        li.setAttribute('draggable', true)
        li.addEventListener('dragstart', dragHandler, false)
      })

      // Luck Die
      html.find('.luck-die').click(this._onRollLuckDie.bind(this))
      html.find('label.luck-die').each((i, li) => {
        // Add draggable attribute and dragstart listener.
        li.setAttribute('draggable', true)
        li.addEventListener('dragstart', dragHandler, false)
      })

      // Spell Checks
      html.find('.spell-check').click(this._onRollSpellCheck.bind(this))
      html.find('.spell-item-button').click(this._onRollSpellCheck.bind(this))
      html.find('label.spell-check').each((i, li) => {
        // Add draggable attribute and dragstart listener.
        li.setAttribute('draggable', true)
        li.addEventListener('dragstart', dragHandler, false)
      })
      html.find('li.spell-item').each((i, li) => {
        // Add draggable attribute and dragstart listener.
        li.setAttribute('draggable', true)
        li.addEventListener('dragstart', dragHandler, false)
      })

      // Attack Bonus
      html.find('.attack-bonus').click(this._onRollAttackBonus.bind(this))
      html.find('.attack-bonus').each((i, li) => {
        // Add draggable attribute and dragstart listener.
        li.setAttribute('draggable', true)
        li.addEventListener('dragstart', dragHandler, false)
      })

      // Weapons
      html.find('.weapon-button').click(this._onRollWeaponAttack.bind(this))
      html.find('li.weapon').each((i, li) => {
        // Add draggable attribute and dragstart listener.
        li.setAttribute('draggable', true)
        li.addEventListener('dragstart', dragHandler, false)
      })

      // Only for editable sheets
      if (this.options.editable) {
        // Add Inventory Item
        html.find('.item-create').click(this._onItemCreate.bind(this))

        // Update Inventory Item
        html.find('.item-edit').click(ev => {
          const li = $(ev.currentTarget).parents('.item')
          const item = this.actor.getOwnedItem(li.data('itemId'))
          item.sheet.render(true)
        })

        // Delete Inventory Item
        html.find('.item-delete').click(ev => {
          const li = $(ev.currentTarget).parents('.item')
          this.actor.deleteOwnedItem(li.data('itemId'))
          li.slideUp(200, () => this.render(false))
        })
      }
    } else {
      // Otherwise remove rollable classes
      html.find('.rollable').each((i, el) => el.classList.remove('rollable'))
    }
  }

  /**
   * Display sheet specific configuration settings
   * @param {Event} event   The originating click event
   * @private
   */
  _onConfigureActor (event) {
    event.preventDefault()
    new DCCActorConfig(this.actor, {
      top: this.position.top + 40,
      left: this.position.left + (this.position.width - 400) / 2
    }).render(true)
  }

  /**
   * Prompt to Clear This Sheet
   * @param {Event} event   The originating click event
   * @private
   */
  _onClearSheet (event) {
    event.preventDefault()
    new Dialog({
      title: game.i18n.localize('DCC.ClearSheet'),
      content: `<p>${game.i18n.localize('DCC.ClearSheetExplain')}</p>`,
      buttons: {
        yes: {
          icon: '<i class="fas fa-check"></i>',
          label: 'Yes',
          callback: () => this._clearSheet()
        },
        no: {
          icon: '<i class="fas fa-times"></i>',
          label: 'No'
        }
      }
    }).render(true)
  }

  /**
   * Clear out all form fields on this sheet
   * @private
   */
  _clearSheet () {
    [...this.form.elements].forEach((el) => {
      el.value = ''
    })
  }

  /**
   * Create a macro when a rollable element is dragged
   * @param {Event} event
   * @override */
  _onDragStart (event) {
    let dragData = null

    // Handle the various draggable elements on the sheet
    const classes = event.target.classList
    if (classes.contains('ability')) {
      // Normal ability rolls and DCC d20 roll under luck rolls
      const abilityId = event.currentTarget.dataset.ability
      const rollUnder = (abilityId === 'lck')
      dragData = {
        type: 'Ability',
        actorId: this.actor.id,
        data: {
          abilityId: abilityId,
          rollUnder: rollUnder
        }
      }
    } else if (classes.contains('ability-modifiers')) {
      // Force d20 + Mod roll over (for non-standard luck rolls) by dragging the modifier
      const abilityId = event.currentTarget.parentElement.dataset.ability
      if (abilityId) {
        dragData = {
          type: 'Ability',
          actorId: this.actor.id,
          data: {
            abilityId: abilityId,
            rollUnder: false
          }
        }
      }
    } else if (classes.contains('init')) {
      dragData = {
        type: 'Initiative',
        actorId: this.actor.id,
        data: {}
      }
    } else if (classes.contains('save')) {
      dragData = {
        type: 'Save',
        actorId: this.actor.id,
        data: event.currentTarget.dataset.save
      }
    } else if (classes.contains('skill-check')) {
      const skillId = event.currentTarget.parentElement.dataset.skill
      dragData = {
        type: 'Skill',
        actorId: this.actor.id,
        data: {
          skillId: skillId,
          skillName: this.actor.data.data.skills[skillId].label
        }
      }
    } else if (classes.contains('luck-die')) {
      dragData = {
        type: 'Luck Die',
        actorId: this.actor.id,
        data: {}
      }
    } else if (classes.contains('spell-check')) {
      dragData = {
        type: 'Spell Check',
        actorId: this.actor.id,
        data: {
          ability: event.currentTarget.parentElement.dataset.ability
        }
      }
    } else if (classes.contains('spell-item')) {
      const spell = event.currentTarget.dataset.spell
      const spellItem = this.actor.items.find(i => i.name === spell)
      let img
      if (spellItem) {
        img = spellItem.data.img
      }
      dragData = {
        type: 'Spell Check',
        actorId: this.actor.id,
        data: {
          ability: event.currentTarget.dataset.ability,
          spell: spell,
          img: img
        }
      }
    } else if (classes.contains('attack-bonus')) {
      dragData = {
        type: 'Attack Bonus',
        actorId: this.actor.id,
        data: {}
      }
    } else if (classes.contains('weapon')) {
      const li = event.currentTarget
      const weapon = this.actor.items.get(li.dataset.itemId)
      dragData = {
        type: 'Weapon',
        actorId: this.actor.id,
        data: {
          weapon: weapon,
          slot: li.dataset.itemSlot
        }
      }
    }

    if (dragData) {
      if (this.actor.isToken) dragData.tokenId = this.actor.token.id
      event.dataTransfer.setData('text/plain', JSON.stringify(dragData))
    }
  }

  /**
   * Prompt for a stat block to import
   * @param {Event} event   The originating click event
   * @private
   */
  _onPasteStatBlock (event) {
    event.preventDefault()
    const html = `<form id="stat-block-form">
            <p><a href="https://purplesorcerer.com/create.php?oc=rulebook&mode=3d6&stats=&abLow=Any&abHigh=Any&hp=normal&at=toggle&display=text&sc=4">${game.i18n.localize('DCC.PurpleSorcererPCLink')}</a></p>
            <textarea name="statblock"></textarea>
        </form>`
    new Dialog({
      title: game.i18n.localize('DCC.PasteBlock'),
      content: html,
      buttons: {
        yes: {
          icon: '<i class="fas fa-check"></i>',
          label: 'Import Stats',
          callback: html => this._pasteStateBlock(html)
        },
        no: {
          icon: '<i class="fas fa-times"></i>',
          label: 'Cancel'
        }
      }
    }).render(true)
  }

  /**
   * Import a stat block
   * @param {string} statBlockHTML   The stat block to import
   * @private
   */
  _pasteStateBlock (statBlockHTML) {
    const statBlock = statBlockHTML[0].querySelector('#stat-block-form')[0].value
    const parsedNPC = this.getData().isNPC ? parseNPC(statBlock) : parsePC(statBlock)
    // console.log(this.object.data.data)
    Object.entries(parsedNPC).forEach(([key, value]) => {
      // console.log(key + ' ' + value)
      // ToDo: Cannot set notes this way as the text editor is not a standard form input
      if (this.form[key]) this.form[key].value = value
    })
  }

  /* -------------------------------------------- */

  /**
   * Handle rolling an Ability check
   * @param {Event} event   The originating click event
   * @private
   */
  _onRollAbilityCheck (event) {
    event.preventDefault()
    const options = {}
    if (event.currentTarget.className === 'ability-modifiers') {
      options.modClick = true
    }

    const ability = event.currentTarget.parentElement.dataset.ability

    // Luck checks are roll under unless the user explicitly clicks the modifier
    const rollUnder = (ability === 'lck') && (event.currentTarget.className !== 'ability-modifiers')

    this.actor.rollAbilityCheck(ability, { rollUnder: rollUnder })
  }

  /**
   * Handle rolling Initiative
   * @param {Event} event   The originating click event
   * @private
   */
  _onRollInitiative (event) {
    event.preventDefault()
    this.actor.rollInitiative({ event: event })
  }

  /**
   * Handle rolling a saving throw
   * @param {Event} event   The originating click event
   * @private
   */
  _onRollSavingThrow (event) {
    event.preventDefault()
    const save = event.currentTarget.parentElement.dataset.save
    this.actor.rollSavingThrow(save, { event: event })
  }

  /**
   * Handle rolling a skill check
   * @param {Event} event   The originating click event
   * @private
   */
  _onRollSkillCheck (event) {
    event.preventDefault()
    const skill = event.currentTarget.parentElement.dataset.skill
    this.actor.rollSkillCheck(skill, { event: event })
  }

  /**
   * Handle rolling the luck die
   * @param {Event} event   The originating click event
   * @private
   */
  _onRollLuckDie (event) {
    event.preventDefault()
    this.actor.rollLuckDie({ event: event })
  }

  /**
   * Handle rolling a spell check
   * @param {Event} event   The originating click event
   * @private
   */
  _onRollSpellCheck (event) {
    event.preventDefault()
    const dataset = event.currentTarget.parentElement.dataset
    if (dataset.itemId) {
      // Roll through a spell item
      const item = this.actor.items.find(i => i.id === dataset.itemId)
      const ability = dataset.ability || 'int'
      item.rollSpellCheck(ability)
    } else {
      // Roll a raw spell check for the actor
      this.actor.rollSpellCheck()
    }
  }

  /**
   * Handle rolling attack bonus
   * @param {Event} event   The originating click event
   * @private
   */
  _onRollAttackBonus (event) {
    if (this.actor._getConfig().rollAttackBonus) {
      event.preventDefault()
      this.actor.rollAttackBonus({ event: event })
      this.render(false)
    }
  }

  /**
   * Handle rolling a weapon attack
   * @param {Event} event   The originating click event
   * @private
   */
  _onRollWeaponAttack (event) {
    event.preventDefault()
    const slot = event.currentTarget.parentElement.dataset.itemSlot
    this.actor.rollWeaponAttack(slot, { event: event })
  }

  /**
   * Handle creating a new Owned Item for the actor using initial data defined in the HTML dataset
   * @param {Event} event   The originating click event
   * @private
   */
  _onItemCreate (event) {
    event.preventDefault()
    const header = event.currentTarget
    // Get the type of item to create.
    const type = header.dataset.type
    // Grab any data associated with this control.
    const data = duplicate(header.dataset)
    // Initialize a default name.
    const name = `New ${type.capitalize()}`
    // Prepare the item object.
    const itemData = {
      name: name,
      type: type,
      data: data
    }
    // Remove the type from the dataset since it's in the itemData.type prop.
    delete itemData.data.type

    // Finally, create the item!
    return this.actor.createOwnedItem(itemData)
  }

  /* -------------------------------------------- */

  /** @override */
  setPosition (options = {}) {
    const position = super.setPosition(options)
    const sheetBody = this.element.find('.sheet-body')
    const bodyHeight = position.height - 192
    sheetBody.css('height', bodyHeight)
    return position
  }

  /* -------------------------------------------- */

  /** @override */
  _updateObject (event, formData) {
    // Handle owned item updates separately
    if (event.currentTarget) {
      const parentElement = event.currentTarget.parentElement
      if (formData.itemUpdates &&
          (parentElement.classList.contains('weapon') || parentElement.classList.contains('armor'))) {
        const itemId = parentElement.dataset.itemId
        const item = this.actor.getOwnedItem(itemId)
        if (item) {
          const updateData = formData.itemUpdates[itemId]
          item.update(updateData)
        }
      }
    }

    // Update the Actor
    return this.object.update(formData)
  }
}

export default DCCActorSheet
