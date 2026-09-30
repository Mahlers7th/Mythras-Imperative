/**
 * mythras-imperative/module/utils/hopeless-check.js
 *
 * A requested skill check whose grade composes to Hopeless (v1.4.364).
 *
 * Rules: a Hopeless task cannot be attempted — no roll, it simply fails. The
 * sheet roll always honoured that (MythrasRoll.execute), but requestSkillCheck
 * graded each skill with roll-math's applyDifficulty, which deliberately
 * returns the skill UNCHANGED for 'hopeless' (callers are meant to handle it),
 * so a Hopeless request was rolled against the full skill. A target of 0 would
 * not do either: 01-05 always succeed. So a Hopeless skill is simply not
 * offered, and if every offered skill is Hopeless the check fails outright.
 *
 * Pure — tested directly.
 */

/**
 * @param {{name: string, grade?: string}[]} skillOptions
 * @returns {{ playable: object[], allHopeless: boolean }}
 */
export function splitHopeless(skillOptions) {
  const list = skillOptions ?? [];
  const playable = list.filter(o => o?.grade !== 'hopeless');
  return { playable, allHopeless: list.length > 0 && playable.length === 0 };
}

/**
 * The result requestSkillCheck returns for a check that could not be
 * attempted: the same shape as a rolled one, failed, with no roll.
 * @param {{name: string, total?: number, rawTotal?: number}} option  the first offered skill
 */
export function hopelessResult(option) {
  return {
    chosenSkillName:  option?.name ?? null,
    chosenSkillTotal: option?.total ?? null,
    chosenSkillRaw:   option?.rawTotal ?? null,
    roll: null, grade: 'failure', succeeds: false,
    cancelled: false, gmOverride: false, reason: 'hopeless',
  };
}
