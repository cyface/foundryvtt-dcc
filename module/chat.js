/**
 * Highlight critical success or failure on d20 rolls
 */
export const highlightCriticalSuccessFailure = function (message, html, data) {
  if (!message.roll || !message.isContentVisible) return

  // Highlight rolls where the first part is a d20 roll
  const roll = message.roll
  if (!roll.dice.length) return
  const d = roll.dice[0]

  // Ensure it is a d20 roll
  const isD20 = (d.faces === 20) && (d.results.length === 1)
  if (!isD20) return

  // Highlight successes and failures
  if (d.total >= 20) html.find('.dice-total').addClass('critical')
  else if (d.total <= 1) html.find('.dice-total').addClass('fumble')
}

/* -------------------------------------------- */

/**
 * This function is used to hook into the Chat Log context menu to add additional options to each message
 * These options make it easy to conveniently apply damage to controlled tokens based on the value of a Roll
 *
 * @param {HTMLElement} html    The Chat Message being rendered
 * @param {Array} options       The Array of Context Menu options
 *
 * @return {Array}              The extended options Array including new context choices
 */
export const addChatMessageContextOptions = function(html, options) {
  let canApply = li => canvas.tokens.controlled.length && li.find(".damage-applyable").length;
  options.push(
    {
      name: game.i18n.localize("DCC.ChatContextDamage"),
      icon: '<i class="fas fa-user-minus"></i>',
      condition: canApply,
      callback: li => applyChatCardDamage(li, 1)
    },
  );
  options.push(
    {
      name: game.i18n.localize("DCC.ChatContextHealing"),
      icon: '<i class="fas fa-user-plus"></i>',
      condition: canApply,
      callback: li => applyChatCardDamage(li, -1)
    },
  );
  return options;
}

/* -------------------------------------------- */

/**
 * Apply rolled dice damage to the token or tokens which are currently controlled.
 * This allows for damage to be scaled by a multiplier to account for healing, critical hits, or resistance
 *
 * @param {HTMLElement} roll    The chat entry which contains the roll data
 * @param {Number} multiplier   A damage multiplier to apply to the rolled damage.
 * @return {Promise}
 */
function applyChatCardDamage(roll, multiplier) {
  const amount = roll.find('.damage-applyable').text();
  return Promise.all(canvas.tokens.controlled.map(t => {
    const a = t.actor;
    return a.applyDamage(amount, multiplier);
  }));
}

