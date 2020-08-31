/* Tests for Actor.js using Foundry Mocks */
/* Mocks for Foundry Classes/Functions are found in __mocks__/foundry.js */
/* Mocks for DCCItem Class are found in __mocks__/item.js */
/* eslint-env jest */
/* global CONFIG, Roll, DCCItem, rollToMessageMock, collectionFindMock, dccItemRollSpellCheckMock, uiNotificationsWarnMock */

import DCCActor from '../actor'

// Create Base Test Actor
const actor = new DCCActor()

test('prepareData sets ability modifiers', () => {
  const abilities = actor.data.data.abilities

  expect(abilities.str.value).toEqual(6)
  expect(abilities.str.mod).toEqual(-1)

  expect(abilities.agl.value).toEqual(8)
  expect(abilities.agl.mod).toEqual(-1)

  expect(abilities.sta.value).toEqual(12)
  expect(abilities.sta.mod).toEqual(0)

  expect(abilities.int.value).toEqual(14)
  expect(abilities.int.mod).toEqual(1)

  expect(abilities.per.value).toEqual(16)
  expect(abilities.per.mod).toEqual(2)

  expect(abilities.lck.value).toEqual(18)
  expect(abilities.lck.mod).toEqual(3)
})

test('roll ability check', () => {
  actor.rollAbilityCheck('str')
  expect(Roll).toHaveBeenCalledTimes(1)
  expect(Roll).toHaveBeenCalledWith('1d20+@abilMod', { abilMod: -1, critical: 20 })
  expect(rollToMessageMock).toHaveBeenCalledWith({ flavor: 'AbilityStr Check', speaker: actor })

  // Check that rollUnder option is interpreted correctly
  actor.rollAbilityCheck('lck', { rollUnder: true })
  expect(Roll).toHaveBeenCalledTimes(2)
  expect(Roll).toHaveBeenCalledWith('1d20')
  expect(rollToMessageMock).toHaveBeenLastCalledWith({ flavor: 'AbilityLck Check', speaker: actor })

  // ...both ways
  actor.rollAbilityCheck('lck', { rollUnder: false })
  expect(Roll).toHaveBeenCalledTimes(3)
  expect(Roll).toHaveBeenCalledWith('1d20+@abilMod', { abilMod: -1, critical: 20 })
  expect(rollToMessageMock).toHaveBeenLastCalledWith({ flavor: 'AbilityLck Check', speaker: actor })

  Roll.mockClear()
})

test('roll saving throw', () => {
  actor.rollSavingThrow('frt')
  expect(Roll).toHaveBeenCalledTimes(1)
  expect(Roll).toHaveBeenCalledWith('1d20+@saveMod', { saveMod: -1 })
  expect(rollToMessageMock).toHaveBeenCalledWith({ flavor: 'SavesFortitude Save', speaker: actor })

  actor.rollSavingThrow('ref')
  expect(Roll).toHaveBeenCalledTimes(2)
  expect(Roll).toHaveBeenCalledWith('1d20+@saveMod', { saveMod: 0 })
  expect(rollToMessageMock).toHaveBeenCalledWith({ flavor: 'SavesReflex Save', speaker: actor })

  actor.rollSavingThrow('wil')
  expect(Roll).toHaveBeenCalledTimes(3)
  expect(Roll).toHaveBeenCalledWith('1d20+@saveMod', { saveMod: +12 })
  expect(rollToMessageMock).toHaveBeenCalledWith({ flavor: 'SavesWill Save', speaker: actor })

  Roll.mockClear()
})

test('roll initiative', () => {
  actor.rollInitiative()
  expect(Roll).toHaveBeenCalledTimes(1)
  expect(Roll).toHaveBeenCalledWith('1d20+@init', { init: -1 })
  expect(rollToMessageMock).toHaveBeenCalledWith({ flavor: 'Initiative', speaker: actor })

  Roll.mockClear()
})

test('roll weapon attack', () => {
  actor.rollWeaponAttack('m1')
  expect(Roll).toHaveBeenCalledTimes(2)
  expect(Roll).toHaveBeenCalledWith('1d20 + 1', { ab: 0, critical: 20 })
  expect(CONFIG.ChatMessage.entityClass.create).toHaveBeenCalledWith({
    user: 1,
    speaker: { alias: 'test character', _id: 1 },
    type: 'emote',
    content: 'AttackRollEmote,weaponName:longsword,rollHTML:<a class="inline-roll inline-result" data-roll="%7B%22dice%22%3A%5B%7B%22results%22%3A%5B10%5D%7D%5D%7D" title="1d20 + 1"><i class="fas fa-dice-d20"></i> undefined</a>,damageRollHTML:<a class="inline-roll inline-result damage-applyable" data-roll="%7B%22dice%22%3A%5B%7B%22results%22%3A%5B10%5D%7D%5D%7D" data-damage="undefined" title="undefined"><i class="fas fa-dice-d20"></i> undefined</a>,crit:,fumble:[object Object]',
    sound: 'diceSound'
  })

  Roll.mockClear()
})

test('roll skill check', () => {
  actor.rollSkillCheck('customDieSkill')
  expect(Roll).toHaveBeenCalledTimes(1)
  expect(Roll).toHaveBeenCalledWith('1d14')
  expect(rollToMessageMock).toHaveBeenCalledWith({ flavor: 'Custom Die Skill', speaker: actor })

  actor.rollSkillCheck('customDieAndValueSkill')
  expect(Roll).toHaveBeenCalledTimes(2)
  expect(Roll).toHaveBeenCalledWith('1d14+@bonus', { bonus: +3 })
  expect(rollToMessageMock).toHaveBeenCalledWith({ flavor: 'Custom Die And Value Skill', speaker: actor })

  actor.rollSkillCheck('actionDieSkill')
  expect(Roll).toHaveBeenCalledTimes(3)
  expect(Roll).toHaveBeenCalledWith('1d20+@bonus', { bonus: -4 })
  expect(rollToMessageMock).toHaveBeenCalledWith({ flavor: 'Action Die Skill', speaker: actor })

  actor.rollSkillCheck('customDieSkillWithInt')
  expect(Roll).toHaveBeenCalledTimes(4)
  expect(Roll).toHaveBeenCalledWith('1d14')
  expect(rollToMessageMock).toHaveBeenCalledWith({ flavor: 'Custom Die Skill With Int (AbilityInt)', speaker: actor })

  actor.rollSkillCheck('customDieAndValueSkillWithPer')
  expect(Roll).toHaveBeenCalledTimes(5)
  expect(Roll).toHaveBeenCalledWith('1d14+@bonus', { bonus: +3 })
  expect(rollToMessageMock).toHaveBeenCalledWith({ flavor: 'Custom Die And Value Skill With Per (AbilityPer)', speaker: actor })

  actor.rollSkillCheck('actionDieSkillWithLck')
  expect(Roll).toHaveBeenCalledTimes(6)
  expect(Roll).toHaveBeenCalledWith('1d20+@bonus', { bonus: -4 })
  expect(rollToMessageMock).toHaveBeenCalledWith({ flavor: 'Action Die Skill With Lck (AbilityLck)', speaker: actor })

  Roll.mockClear()
})

test('roll luck die', () => {
  actor.rollLuckDie()
  expect(Roll).toHaveBeenCalledTimes(1)

  Roll.mockClear()
})

test('roll spell check', () => {
  // Spell check with ability from actor data
  actor.rollSpellCheck()
  expect(Roll).toHaveBeenCalledTimes(1)
  expect(Roll).toHaveBeenCalledWith('@die+@bonus', { die: '1d20', bonus: +3 })
  expect(rollToMessageMock).toHaveBeenCalledWith({ flavor: 'SpellCheck (AbilityInt)', speaker: actor })
  expect(collectionFindMock).toHaveBeenCalledTimes(0)

  // Force int for display purposes
  actor.rollSpellCheck({ abilityId: 'int' })
  expect(Roll).toHaveBeenCalledTimes(2)
  expect(Roll).toHaveBeenCalledWith('@die+@bonus', { die: '1d20', bonus: +3 })
  expect(rollToMessageMock).toHaveBeenCalledWith({ flavor: 'SpellCheck (AbilityInt)', speaker: actor })
  expect(collectionFindMock).toHaveBeenCalledTimes(0)

  // Force personality for display purposes
  actor.rollSpellCheck({ abilityId: 'per' })
  expect(Roll).toHaveBeenCalledTimes(3)
  expect(Roll).toHaveBeenCalledWith('@die+@bonus', { die: '1d20', bonus: +3 })
  expect(rollToMessageMock).toHaveBeenCalledWith({ flavor: 'SpellCheck (AbilityPer)', speaker: actor })
  expect(collectionFindMock).toHaveBeenCalledTimes(0)

  // Roll a spell check with an item
  collectionFindMock.mockReturnValue(new DCCItem('The Gloaming', { type: 'spell' }))
  actor.rollSpellCheck({ spell: 'The Gloaming' })
  expect(collectionFindMock).toHaveBeenCalledTimes(1)
  expect(dccItemRollSpellCheckMock).toHaveBeenCalledWith('int')
  expect(uiNotificationsWarnMock).toHaveBeenCalledTimes(0)

  // Roll a spell check with an item of the wrong type
  collectionFindMock.mockReturnValue(new DCCItem('Swordfish', { type: 'weapon' }))
  actor.rollSpellCheck({ spell: 'Swordfish' })
  expect(collectionFindMock).toHaveBeenCalledTimes(2)
  expect(dccItemRollSpellCheckMock).toHaveBeenCalledWith('int')
  expect(uiNotificationsWarnMock).toHaveBeenCalledTimes(1)
  expect(uiNotificationsWarnMock).toHaveBeenCalledWith('SpellCheckNonSpellWarning')

  // Roll a spell check with an unowned item
  collectionFindMock.mockReturnValue(null)
  actor.rollSpellCheck({ spell: 'Missing Spell' })
  expect(collectionFindMock).toHaveBeenCalledTimes(3)
  expect(dccItemRollSpellCheckMock).toHaveBeenCalledWith('int')
  expect(uiNotificationsWarnMock).toHaveBeenCalledTimes(2)
  expect(uiNotificationsWarnMock).toHaveBeenCalledWith('SpellCheckNoOwnedItemWarning')

  Roll.mockClear()
})
