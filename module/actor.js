/* global Actor, ChatMessage, CONFIG, CONST, game, ui, Roll, Dialog, mergeObject */

/**
 * Extend the base Actor entity by defining a custom roll data structure.
 * @extends {Actor}
 */
class DCCActor extends Actor {
  /** @override */
  prepareBaseData () {
    super.prepareBaseData()

    // Ability modifiers
    const abilities = this.data.data.abilities
    for (const abilityId in abilities) {
      abilities[abilityId].mod = CONFIG.DCC.abilities.modifiers[abilities[abilityId].value] || 0
    }

    // Get configuration data
    const config = this._getConfig()
    const data = this.data.data

    // Cap level if required
    if (config.capLevel) {
      data.details.level.value = Math.max(0, Math.min(data.details.level.value, parseInt(config.maxLevel)))
    }

    // Determine the correct fumble die and check penalty to use based on armor
    let fumbleDieRank = 0
    let fumbleDie = '1d4'
    let checkPenalty = 0
    let speedPenalty = 0
    if (this.itemTypes) {
      for (const armorItem of this.itemTypes.armor) {
        if (armorItem.data.data.equipped) {
          try {
            checkPenalty += parseInt(armorItem.data.data.checkPenalty || 0)
            speedPenalty += parseInt(armorItem.data.data.speed || 0)
            const expression = armorItem.data.data.fumbleDie
            const rank = game.dcc.DiceChain.rankDiceExpression(expression)
            if (rank > fumbleDieRank) {
              fumbleDieRank = rank
              fumbleDie = expression
            }
          } catch (err) {
            // Ignore bad fumble die expressions
          }
        }
      }
    }
    data.attributes.fumble = mergeObject(
      data.attributes.fumble || {},
      { die: fumbleDie }
    )
    if (data.config.computeCheckPenalty) {
      data.attributes.ac.checkPenalty = checkPenalty
    }
    data.attributes.ac.speedPenalty = speedPenalty
  }

  /** @override */
  prepareDerivedData () {
    super.prepareDerivedData()

    // Get configuration data
    const config = this._getConfig()
    const data = this.data.data

    // Compute AC if required
    if (config.computeAC) {
      const baseACAbility = data.abilities[config.baseACAbility] || { mod: 0 }
      const abilityMod = baseACAbility.mod
      let armorBonus = 0
      for (const armorItem of this.itemTypes.armor) {
        if (armorItem.data.data.equipped) {
          armorBonus += parseInt(armorItem.data.data.acBonus) || 0
        }
      }
      data.attributes.ac.value = 10 + abilityMod + armorBonus
    }

    // Gather available action dice
    try {
      // Implicit migration for legacy actors
      if (!this.data.data.config.actionDice) {
        this.data.data.config.actionDice = this.data.data.attributes.actionDice.value
      }
      // Parse the action dice expression from the config and produce a list of available dice
      const actionDieExpression = new Roll(this.data.data.config.actionDice || '1d20')
      const terms = actionDieExpression.terms || actionDieExpression.parts
      const actionDice = []
      for (const term of terms) {
        if (typeof (term) === 'object' && term.faces) {
          const termDie = `1d${term.faces}`
          const termCount = term.number || 1
          for (let i = 0; i < termCount; ++i) {
            actionDice.push(termDie)
          }
        }
      }
      this.data.data.attributes.actionDice.options = actionDice
    } catch (err) { }
  }

  /**
   * Get per actor configuration
   *
   * @return {Object}       Configuration data
   */
  _getConfig () {
    let defaultConfig = {
      actionDice: '1d20',
      capLevel: false,
      maxLevel: 0,
      rollAttackBonus: false,
      rollABWithAttack: false,
      computeAC: false,
      baseACAbility: 'agl',
      sortInventory: true,
      removeEmptyItems: true,
      showSpells: false,
      showSkills: false,
      showMaxAttributes: false,
      showBackstab: false
    }

    // Merge any existing data with defaults to implicitly migrate missing config fields
    defaultConfig = Object.assign(defaultConfig, this.data.data.config)
    this.data.data.config = defaultConfig

    return defaultConfig
  }

  /**
   * Roll an Ability Check
   * @param {String} abilityId    The ability ID (e.g. "str")
   * @param {Object} options      Options which configure how ability checks are rolled
   */
  async rollAbilityCheck (abilityId, options = {}) {
    const ability = this.data.data.abilities[abilityId]
    ability.mod = CONFIG.DCC.abilities.modifiers[ability.value] || 0
    ability.label = CONFIG.DCC.abilities[abilityId]

    let roll

    // Allow requesting roll under (for Luck Checks)
    if (options.rollUnder) {
      roll = new Roll('1d20')

      // Apply custom roll options
      await roll.evaluate({ async: true })
      roll.dice[0].options.dcc = {
        rollUnder: true
      }
    } else {
      const die = this.data.data.attributes.actionDice.value
      roll = new Roll('@die+@abilMod', { die, abilMod: ability.mod, critical: 20 })
    }

    // Convert the roll to a chat message
    roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${game.i18n.localize(ability.label)} ${game.i18n.localize('DCC.Check')}`
    })
  }

  /**
   * Roll Initiative
   * @param {Object} token    The token to roll initiative for
   */
  async rollInitiative (token) {
    // No selected token - bail out
    if (!token) {
      return ui.notifications.warn(game.i18n.localize('DCC.InitiativeNoTokenWarning'))
    }

    // Setup the roll
    const die = this.data.data.attributes.init.die || '1d20'
    const init = this.data.data.attributes.init.value
    const roll = new Roll('@die+@init', { die, init })

    // Convert the roll to a chat message
    roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: game.i18n.localize('DCC.Initiative')
    })

    // No combat active
    if (!game.combat) {
      return ui.notifications.warn(game.i18n.localize('DCC.InitiativeNoCombatWarning'))
    }

    // Set initiative value in the combat tracker if appropriate
    const tokenId = token.id
    const combatant = game.combat.getCombatantByToken(tokenId)
    if (!combatant) {
      return ui.notifications.warn(game.i18n.format('DCC.InitiativeNoCombatantWarning', {
        name: token.name
      }))
    }

    await game.combat.setInitiative(combatant.id, roll.total)
  }

  /**
   * Roll Hit Dice
   */
  async rollHitDice () {
    let roll

    if (this.data.type === 'Player') {
      const die = this.data.data.attributes.hitDice.value || '1d4'
      const sta = this.data.data.abilities.sta || {}
      sta.mod = sta.value ? CONFIG.DCC.abilities.modifiers[sta.value] : 0
      roll = new Roll('@die+@mod', { die, mod: sta.mod })
    } else {
      const die = this.data.data.attributes.hitDice.value || '1d4'
      roll = new Roll('@die', { die })
    }

    // Convert the roll to a chat message
    roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: game.i18n.localize('DCC.HitDice')
    })
  }

  /**
   * Roll a Saving Throw
   * @param {String} saveId       The save ID (e.g. "ref")
   */
  async rollSavingThrow (saveId) {
    const save = this.data.data.saves[saveId]
    const die = '1d20'
    save.label = CONFIG.DCC.saves[saveId]
    const roll = new Roll('@die+@saveMod', { die, saveMod: save.value })

    // Convert the roll to a chat message
    roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${game.i18n.localize(save.label)} ${game.i18n.localize('DCC.Save')}`
    })
  }

  /**
   * Roll a Skill Check
   * @param {String}  skillId       The skill ID (e.g. "sneakSilently")
   */
  async rollSkillCheck (skillId) {
    let skill = this.data.data.skills ? this.data.data.skills[skillId] : null
    let skillItem = null
    if (!skill) {
      skillItem = this.itemTypes.skill.find(i => i.name === skillId)
      if (skillItem) {
        skill = {
          label: skillItem.name
        }
        if (skillItem.data.data.config.useAbility) {
          skill.ability = skillItem.data.data.ability
        }
        if (skillItem.data.data.config.useDie) {
          skill.die = skillItem.data.data.die
        }
        if (skillItem.data.data.config.useValue) {
          skill.value = skillItem.data.data.value
        }
      }
    }
    const die = skill.die || this.data.data.attributes.actionDice.value
    const ability = skill.ability || null
    var abilityLabel = ''
    if (ability) {
      abilityLabel = ` (${game.i18n.localize(CONFIG.DCC.abilities[ability])})`
    }

    // Collate modifiers for the roll
    const modifiers = {}
    if (skill.value) {
      modifiers.bonus = skill.value
    }
    if (skill.useDeed && this.data.data.details.lastRolledAttackBonus) {
      // Last deed roll
      modifiers.ab = parseInt(this.data.data.details.lastRolledAttackBonus)
    }

    const roll = game.dcc.DCCRoll.createSimpleRoll(die, modifiers)
    await roll.evaluate({ async: true })

    // Handle special cleric spellchecks that are treated as skills
    if (skill.useDisapprovalRange) {
      if (roll.dice.length > 0) {
        roll.dice[0].options.dcc = {
          lowerThreshold: this.data.data.class.disapproval
        }
      }
    }

    // Convert the roll to a chat message
    roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${game.i18n.localize(skill.label)}${abilityLabel}`
    })

    // Store last result if required
    if (skillItem && skillItem.data.data.config.showLastResult) {
      skillItem.update({ 'data.lastResult': roll.total })
    }
  }

  /**
   * Roll the Luck Die
   */
  rollLuckDie () {
    const roll = new Roll(this.data.data.class.luckDie)

    // Convert the roll to a chat message
    roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${game.i18n.localize('DCC.LuckDie')}`
    })
  }

  /**
   * Roll a Spell Check
   * @param {String} abilityId       The ability used for the check (e.g. "per")
   */
  async rollSpellCheck (options = {}) {
    if (!options.abilityId) {
      options.abilityId = this.data.data.class.spellCheckAbility || ''
    }

    // If a spell name is provided attempt to look up an item with that name for the roll
    if (options.spell) {
      const item = this.items.find(i => i.name === options.spell)
      if (item) {
        if (item.data.type === 'spell') {
          // Roll through the item and return so we don't also roll a basic spell check
          item.rollSpellCheck(options.abilityId)
          return
        } else {
          return ui.notifications.warn(game.i18n.localize('DCC.SpellCheckNonSpellWarning'))
        }
      } else {
        return ui.notifications.warn(game.i18n.localize('DCC.SpellCheckNoOwnedItemWarning'))
      }
    }

    // Otherwise fall back to a raw dice roll with appropriate flavor
    const ability = this.data.data.abilities[options.abilityId] || {}
    ability.label = CONFIG.DCC.abilities[options.abilityId]
    const spell = options.spell ? options.spell : game.i18n.localize('DCC.SpellCheck')
    const die = this.data.data.attributes.actionDice.value
    const bonus = parseInt(this.data.data.class.spellCheck || 0)
    const checkPenalty = parseInt(this.data.data.attributes.ac.checkPenalty || 0)

    // Collate modifiers for the roll
    const modifiers = {
      bonus,
      checkPenalty
    }
    const roll = game.dcc.DCCRoll.createSimpleRoll(die, modifiers)
    await roll.evaluate({ async: true })

    if (roll.dice.length > 0) {
      roll.dice[0].options.dcc = {
        lowerThreshold: this.data.data.class.disapproval
      }
    }

    let flavor = spell
    if (ability.label) {
      flavor += ` (${game.i18n.localize(ability.label)})`
    }

    // Convert the roll to a chat message
    roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor
    })
  }

  /**
   * Roll Attack Bonus
   */
  async rollAttackBonus (options={}) {
    /* Determine attack bonus */
    const attackBonusExpression = this.data.data.details.attackBonus || '0'
    if (attackBonusExpression) {
      const abRoll = new Roll(attackBonusExpression, { critical: 3 })

      // Store the result for use in attack and damage rolls
      const lastRoll = this.data.data.details.lastRolledAttackBonus = (await abRoll.evaluate({ async: true })).total
      await this.update({
        'data.details.lastRolledAttackBonus': lastRoll
      })

      // Apply custom roll options
      if (abRoll.dice.length > 0) {
        abRoll.dice[0].options.dcc = {
          lowerThreshold: 2,
          upperThreshold: 3
        }
      }
      
      // Convert the roll to a chat message
      if (options.displayStandardCards || !options.rollWeaponAttack) {
        abRoll.toMessage({
          speaker: ChatMessage.getSpeaker({ actor: this }),
          flavor: game.i18n.localize('DCC.DeedRoll')
        })
      }
      return {
        rolled: true,
        roll: abRoll,
        formula: game.dcc.DCCRoll.cleanFormula(abRoll.terms),
        attackBonus: lastRoll,
      };
    }

  }

  /*
   * Set Action Dice
   */
  async setActionDice (die) {
    this.update({
      'data.attributes.actionDice.value': die
    })
  }

  /**
   * Roll a weapon's attack, damage, and handle any crits
   * @param {string} weaponId    The weapon name or slot id (e.g. "m1", "r1")
   * @param {Object} options     Options which configure how attacks are rolled E.g. Backstab
   */
  async rollWeaponAttack (weaponId, options = {}) {
    if (options.displayStandardCards === undefined) {
      try {
        options.displayStandardCards = game.settings.get('dcc', 'useStandardDiceRoller')
      } catch (e) { }
    }
    const config = this._getConfig()

    // First try and find the item by name or id
    let weapon = this.items.find(i => i.name === weaponId || i.id === weaponId)

    // If not found try finding it by slot
    if (!weapon) {
      try {
        // Verify this is a valid slot name
        const result = weaponId.match(/^([mr])(\d+)$/)
        if (!result) {
          throw new Error('Invalid slot name')
        }
        const isMelee = weaponId[0] === 'm' // 'm' or 'r'
        const weaponIndex = parseInt(weaponId.slice(1)) - 1 // 1 based indexing
        let weapons = this.itemTypes.weapon
        if (this.data.data.config.sortInventory) {
          // ToDo: Move inventory classification and sorting into the actor so this isn't duplicating code in the sheet
          weapons = [...weapons].sort((a, b) => a.data.name.localeCompare(b.data.name))
        }
        weapon = weapons.filter(i => !!i.data.data.melee === isMelee)[weaponIndex]
      } catch (err) { }
    }

    // If all lookups fail, give up and show a warning
    if (!weapon) {
      return ui.notifications.warn(game.i18n.format('DCC.WeaponNotFound', { id: weaponId }))
    }

    let attackBonusRollResult = 0;
    if (config.rollAttackBonus && config.rollABWithAttack) {
      options.rollWeaponAttack = true;
      attackBonusRollResult = await this.rollAttackBonus(options)
    }

    // Attack roll
    const attackRollResult = await this.rollToHit(weapon, options)

    // Damage roll
    const damageRollResult = await this.rollDamage(weapon, options)

    // Speaker object for the chat cards
    const speaker = { alias: this.name, id: this.id }

    // Output the results
    if (options.displayStandardCards) {
      // Attack roll card
      if (attackRollResult.rolled) {
        attackRollResult.roll.toMessage({
          speaker: ChatMessage.getSpeaker({ actor: this }),
          flavor: game.i18n.format(options.backstab ? 'DCC.BackstabRoll' : 'DCC.AttackRoll', { weapon: weapon.name })
        })
      } else {
        const messageData = {
          user: game.user.id,
          speaker: speaker,
          type: CONST.CHAT_MESSAGE_TYPES.EMOTE,
          content: game.i18n.format('DCC.AttackRollInvalidFormula', {
            formula: attackRollResult.formula,
            weapon: weapon.name
          })
        }
        ChatMessage.applyRollMode(messageData, game.settings.get('core', 'rollMode'))
        await CONFIG.ChatMessage.documentClass.create(messageData)
      }

      // Damage roll card
      if (damageRollResult.rolled) {
        damageRollResult.roll.toMessage({
          speaker: ChatMessage.getSpeaker({ actor: this }),
          flavor: game.i18n.format('DCC.DamageRoll', { weapon: weapon.name })
        })
      } else {
        const messageData = {
          user: game.user.id,
          speaker: speaker,
          type: CONST.CHAT_MESSAGE_TYPES.EMOTE,
          content: game.i18n.format('DCC.DamageRollInvalidFormula', {
            formula: damageRollResult.formula,
            weapon: weapon.name
          })
        }
        ChatMessage.applyRollMode(messageData, game.settings.get('core', 'rollMode'))
        await CONFIG.ChatMessage.documentClass.create(messageData)
      }

      // Roll crits or fumbles
      if (attackRollResult.crit) {
        this.rollCritical(options)
      } else if (attackRollResult.fumble) {
        this.rollFumble(options)
      }
    } else {
      const attackRollHTML = this._formatAttackRoll(attackRollResult)
      const damageRollHTML = this._formatDamageRoll(damageRollResult)
      const attackBonusRollHTML = this._formatAttackBonusRoll(attackBonusRollResult)

      // Check for crits or fumbles
      let critResult = ''
      let fumbleResult = ''

      if (attackRollResult.crit) {
        critResult = await this.rollCritical(options)
      } else if (attackRollResult.fumble) {
        fumbleResult = await this.rollFumble(options)
      }

      let emote = options.backstab ? 'DCC.BackstabEmote' : 'DCC.AttackRollEmote'
      if (config.rollAttackBonus && config.rollABWithAttack) {
        emote = emote.concat("Deed");
      }

      const messageData = {
        user: game.user.id,
        speaker: speaker,
        type: CONST.CHAT_MESSAGE_TYPES.EMOTE,
        content: game.i18n.format(emote, {
          weaponName: weapon.name,
          rollHTML: attackRollHTML,
          damageRollHTML: damageRollHTML,
          attackBonus: attackBonusRollHTML,
          crit: critResult,
          fumble: fumbleResult
        }),
        sound: CONFIG.sounds.dice
      }
      ChatMessage.applyRollMode(messageData, game.settings.get('core', 'rollMode'))
      await CONFIG.ChatMessage.documentClass.create(messageData)
    }
  }

  /**
   * Roll a weapon's attack roll
   * @param {Object} weaponId    The weapon object being used for the roll
   * @param {Object} options     Options which configure how attacks are rolled E.g. Backstab
   * @return {Object}            Object representing the results of the attack roll
   */
  async rollToHit (weapon, options = {}) {
    const config = this._getConfig()

    /* Grab the To Hit modifier */
    let toHit = weapon.data.data.toHit

    /* Determine backstab bonus if used */
    if (options.backstab) {
      toHit = toHit + ' + ' + parseInt(this.data.data.class.backstab)
    }

    // Determine the formula
    const formula = `${weapon.data.data.actionDie} + ${toHit}`

    /* Determine attack bonus */
    let attackBonus = 0
    if (config.rollAttackBonus) {
      attackBonus = this.data.data.details.lastRolledAttackBonus || 0
    }

    /* Determine crit range */
    const critRange = weapon.data.data.critRange || this.data.data.details.critRange || 20

    /* If we don't have a valid formula, bail out here */
    if (!await Roll.validate(formula)) {
      return {
        rolled: false,
        formula: weapon.data.data.toHit
      }
    }

    /* Roll the Attack */
    const attackRoll = new Roll(formula, { ab: attackBonus, critical: critRange })
    await attackRoll.evaluate({ async: true })

    const d20RollResult = attackRoll.dice[0].total
    attackRoll.dice[0].options.dcc = {
      upperThreshold: critRange
    }

    /* Check for crit or fumble */
    const crit = (d20RollResult > 1 && (d20RollResult >= critRange || options.backstab))
    const fumble = (d20RollResult === 1)

    return {
      rolled: true,
      roll: attackRoll,
      formula: game.dcc.DCCRoll.cleanFormula(attackRoll.terms),
      hitsAc: attackRoll.total,
      d20Roll: d20RollResult,
      crit,
      fumble
    }
  }

  /**
   * Roll a weapon's damage
   * @param {Object} weaponId    The weapon object being used for the roll
   * @param {Object} options     Options which configure how attacks are rolled E.g. Backstab
   * @return {Object}            Object representing the results of the attack roll
   */
  async rollDamage (weapon, options = {}) {
    const config = this._getConfig()

    /* Grab the the formula */
    let formula = weapon.data.data.damage

    /* Are we backstabbing and the weapon has special backstab damage? */
    if (options.backstab && weapon.data.data.backstab) {
      formula = weapon.data.data.backstabDamage || weapon.data.data.damage
    }

    /* Determine attack bonus */
    let attackBonus = 0
    if (config.rollAttackBonus) {
      attackBonus = this.data.data.details.lastRolledAttackBonus || 0
    }

    /* If we don't have a valid formula, bail out here */
    if (Roll.validate !== undefined && !Roll.validate(formula)) {
      return {
        rolled: false,
        formula: weapon.data.data.damage
      }
    }
    /* Roll the damage */
    const damageRoll = new Roll(formula, { ab: attackBonus })
    await damageRoll.evaluate({ async: true })

    return {
      rolled: true,
      roll: damageRoll,
      formula: game.dcc.DCCRoll.cleanFormula(damageRoll.terms),
      damage: damageRoll.total
    }
  }

  /**
   * Roll a Critical Hit
   * @param {Object} options     Options which configure how attacks are rolled E.g. Backstab
   */
  async rollCritical (options) {
    // Roll object for the crit die
    let roll = new Roll(`${this.data.data.attributes.critical.die} + ${this.data.data.abilities.lck.mod}`)

    // Lookup the crit table if available
    let critResult = null
    for (const criticalHitPackName of CONFIG.DCC.criticalHitPacks.packs) {
      if (criticalHitPackName) {
        const pack = game.packs.get(criticalHitPackName)
        if (pack) {
          await pack.getIndex() // Load the compendium index
          const critTableFilter = `Crit Table ${this.data.data.attributes.critical.table}`
          const entry = pack.index.find((entity) => entity.name.startsWith(critTableFilter))
          if (entry) {
            const table = await pack.getDocument(entry._id)
            critResult = await table.draw({ roll, displayChat: options.displayStandardCards })
          }
        }
      }
    }

    // Either roll the die or grab the roll from the table lookup
    if (!critResult) {
      await roll.evaluate({ async: true })
    } else {
      roll = critResult.roll
    }

    if (!options.displayStandardCards) {
      // Create the roll emote
      const rollData = escape(JSON.stringify(roll))
      const rollTotal = roll.total
      const rollHTML = `<a class="inline-roll inline-result" data-roll="${rollData}" data-damage="${rollTotal}" title="${game.dcc.DCCRoll.cleanFormula(roll.terms)}"><i class="fas fa-dice-d20"></i> ${rollTotal}</a>`

      // Display crit result or just a notification of the crit
      if (critResult) {
        return ` <br/><br/><span style='color:#ff0000; font-weight: bolder'>${game.i18n.localize('DCC.CriticalHit')}!</span> ${rollHTML}<br/>${critResult.results[0].getChatText()}`
      } else {
        return ` <br/><br/><span style='color:#ff0000; font-weight: bolder'>${game.i18n.localize('DCC.CriticalHit')}!</span> ${rollHTML}`
      }
    } else if (!critResult) {
      // Display the raw crit roll
      await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: this }),
        flavor: `${game.i18n.localize('DCC.CriticalHit')}!`
      })
    }
  }

  /**
   * Roll a Fumble
   * @param {Object} options     Options which configure how attacks are rolled E.g. Backstab
   */
  async rollFumble (options) {
    let fumbleDie
    try {
      fumbleDie = this.data.data.attributes.fumble.die
    } catch (err) {
      fumbleDie = '1d4'
    }

    // Roll object for the fumble die
    let roll = new Roll(`${fumbleDie} - ${this.data.data.abilities.lck.mod}`)

    // Lookup the fumble table if available
    let fumbleResult = null
    const fumbleTableName = CONFIG.DCC.fumbleTable
    if (fumbleTableName) {
      const fumbleTablePath = fumbleTableName.split('.')
      let pack
      if (fumbleTablePath.length === 3) {
        pack = game.packs.get(fumbleTablePath[0] + '.' + fumbleTablePath[1])
      }
      if (pack) {
        await pack.getIndex() // Load the compendium index
        const entry = pack.index.find((entity) => entity.name === fumbleTablePath[2])
        if (entry) {
          const table = await pack.getDocument(entry._id)
          fumbleResult = await table.draw({ roll, displayChat: options.displayStandardCards })
        }
      }
    }

    // Either roll the die or grab the roll from the table lookup
    if (!fumbleResult) {
      await roll.evaluate({ async: true })
    } else {
      roll = fumbleResult.roll
    }

    if (!options.displayStandardCards) {
      // Create the roll emote
      const rollData = escape(JSON.stringify(roll))
      const rollTotal = roll.total
      const rollHTML = `<a class="inline-roll inline-result" data-roll="${rollData}" data-damage="${rollTotal}" title="${game.dcc.DCCRoll.cleanFormula(roll.terms)}"><i class="fas fa-dice-d20"></i> ${rollTotal}</a>`

      // Display fumble result or just a notification of the fumble
      if (fumbleResult) {
        return ` <br/><br/><span style='color:red; font-weight: bolder'>${game.i18n.localize('DCC.Fumble')}!</span> ${rollHTML}<br/>${fumbleResult.results[0].getChatText()}`
      } else {
        return ` <br/><br/><span style='color:red; font-weight: bolder'>${game.i18n.localize('DCC.Fumble')}!</span> ${rollHTML}`
      }
    } else if (!fumbleResult) {
      // Display the raw fumble roll
      await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: this }),
        flavor: `${game.i18n.localize('DCC.Fumble')}!`
      })
    }
  }

  /**
   * Format an attack roll for display in-line
   * @param {Object} rollResult   The roll result object for the roll
   * @return {string}             Formatted HTML containing roll
   */
  _formatAttackRoll (rollResult) {
    if (rollResult.rolled) {
      const rollData = escape(JSON.stringify(rollResult.roll))

      // Check for Crit/Fumble
      let critFailClass = ''
      if (Number(rollResult.roll.dice[0].results[0]) === 20) { critFailClass = 'critical ' } else if (Number(rollResult.roll.dice[0].results[0]) === 1) { critFailClass = 'fumble ' }

      return `<a class="${critFailClass}inline-roll inline-result" data-roll="${rollData}" title="${rollResult.formula}"><i class="fas fa-dice-d20"></i> ${rollResult.hitsAc}</a>`
    } else {
      return game.i18n.format('DCC.AttackRollInvalidFormulaInline', { formula: rollResult.formula })
    }
  }

  /**
   * Format a damage roll for display in-line
   * @param {Object} rollResult   The roll result object for the roll
   * @return {string}             Formatted HTML containing roll
   */
  _formatDamageRoll (rollResult) {
    if (rollResult.rolled) {
      const rollData = escape(JSON.stringify(rollResult.roll))
      if (rollResult.damage > 0) {
        return `<a class="inline-roll inline-result damage-applyable" data-roll="${rollData}" data-damage="${rollResult.damage}" title="${rollResult.formula}"><i class="fas fa-dice-d20"></i> ${rollResult.damage}</a>`
      } else {
        return `<a class="inline-roll inline-result damage-applyable" data-roll="${rollData}" data-damage="1" title="${rollResult.formula}"><i class="fas fa-dice-d20"></i> 1 (${rollResult.damage})</a>`
      }
    } else {
      return game.i18n.format('DCC.DamageRollInvalidFormulaInline', { formula: rollResult.formula })
    }
  }

  /**
   * Format a Attack Bonus Roll roll for display in-line
   * @param {Object} rollResult   The roll result object for the roll
   * @return {string}             Formatted HTML containing roll
   */
   _formatAttackBonusRoll (rollResult) {
    if (rollResult.rolled) {
      const rollData = escape(JSON.stringify(rollResult.roll))
      // Check for Crit/Fumble
      let critFailClass = ''
      if (Number(rollResult.attackBonus) >= 3) { 
        critFailClass = 'critical ' 
      }
      return `<a class="${critFailClass} inline-roll inline-result" data-roll="${rollData}" title="${rollResult.formula}"><i class="fas fa-dice-d20"></i> ${rollResult.attackBonus}</a>`
    } else {
      return game.i18n.format('DCC.AttackBonusRollInvalidFormulaInline', { formula: rollResult.formula })
    }
  }  

  /**
   * Apply damage to this actor
   * @param {Number} damageAmount   Damage amount to apply
   * @param {Number} multiplier     Damage multiplier
   */
  async applyDamage (damageAmount, multiplier) {
    const speaker = { alias: this.name, id: this.id }

    // Calculate damage amount and current hit points
    const amount = damageAmount * multiplier
    const hp = this.data.data.attributes.hp.value

    let newHp = hp
    if (amount > 0) {
      // Taking damage - just subtract and allow damage to go below zero
      newHp = newHp - amount
    } else {
      // Healing - don't allow HP to be brought above MaxHP, but if it's already there assume it's intentional
      const maxHp = this.data.data.attributes.hp.max
      if (hp >= maxHp) {
        newHp = hp
      } else {
        newHp = Math.min(newHp - amount, maxHp)
      }
    }

    const deltaHp = newHp - hp

    // Announce damage or healing results
    if (Math.abs(deltaHp) > 0) {
      const locstring = (deltaHp > 0) ? 'DCC.HealDamage' : 'DCC.TakeDamage'
      const messageData = {
        user: game.user.id,
        speaker: speaker,
        type: CONST.CHAT_MESSAGE_TYPES.EMOTE,
        content: game.i18n.format(locstring, { target: this.name, damage: Math.abs(deltaHp) }),
        sound: CONFIG.sounds.notification
      }
      ChatMessage.applyRollMode(messageData, game.settings.get('core', 'rollMode'))
      await CONFIG.ChatMessage.documentClass.create(messageData)
    }

    // Apply new HP
    return this.update({
      'data.attributes.hp.value': newHp
    })
  }

  /**
   * Apply a point of disapproval
   */
  applyDisapproval () {
    this.update({
      'data.class.disapproval': this.data.data.class.disapproval + 1
    })
  }

  /**
   * Prompt and roll for disapproval
   */
  async rollDisapproval () {
    const html = `<form id="disapproval-formula-form">
                    <label for="formula">${game.i18n.localize('DCC.DisapprovalRollFormula')}</label>
                    <input type="text" name="formula" placeholder="1d4 - luck modifier" value="1d4 - ${this.data.data.abilities.lck.mod}"/>
                  </form>`
    new Dialog({
      title: game.i18n.localize('DCC.DisapprovalRollFormula'),
      content: html,
      buttons: {
        yes: {
          icon: '<i class="fas fa-check"></i>',
          label: 'Roll Disapproval',
          callback: html => this._onRollDisapproval(html)
        },
        no: {
          icon: '<i class="fas fa-times"></i>',
          label: 'Cancel'
        }
      }
    }).render(true)
  }

  /**
   * Roll disapproval
   * @param {Object} disapprovalRollHTML  form with disapproval formula input
   * @private
   */
  async _onRollDisapproval (disapprovalRollHTML) {
    const formula = disapprovalRollHTML[0].querySelector('#disapproval-formula-form')[0].value

    try {
      const roll = new Roll(formula)

      // Lookup the disapproval table if available
      let disapprovalTable = null
      for (const disapprovalPackName of CONFIG.DCC.disapprovalPacks.packs) {
        const disapprovalTableName = this.data.data.class.disapprovalTable
        if (disapprovalPackName && disapprovalTableName) {
          const pack = game.packs.get(disapprovalPackName)
          if (pack) {
            await pack.getIndex() // Load the compendium index
            const entry = pack.index.find((entity) => `${disapprovalPackName}.${entity.name}` === disapprovalTableName)
            if (entry) {
              disapprovalTable = await pack.getDocument(entry._id)
            }
          }
        }
      }

      // Draw from the table if found, otherwise display the roll
      if (disapprovalTable) {
        const results = disapprovalTable.roll({ roll })
        disapprovalTable.draw(results)
      } else {
        // Fall back to displaying just the roll
        roll.toMessage({
          speaker: ChatMessage.getSpeaker({ actor: this }),
          flavor: game.i18n.localize('DCC.DisapprovalRoll')
        })
      }
    } catch (err) {
      ui.notifications.warn(game.i18n.format('DCC.DisapprovalFormulaWarning', { formula }))
    }
  }
}

export default DCCActor
