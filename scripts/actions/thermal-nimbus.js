const THERMAL_NIMBUS_FEAT_ID = "Compendium.pf2e.feats-srd.Item.XJCsa3UbQtsKcqve";
const THERMAL_NIMBUS_STANCE_ID = "Compendium.pf2e.feat-effects.Item.2EMak2C8x6pFwoUi";
const THERMAL_NIMBUS_DAMAGE_EFFECT_ID = "Compendium.pf2e-kineticists-companion.items.Item.TQCve77Ryu4b764B";

const DamageRoll = CONFIG.Dice.rolls.find((r) => r.name === "DamageRoll");

export class ThermalNimbus {
    static localize(key, data) {
        return game.i18n.format("pf2e-kineticists-companion.thermal-nimbus." + key, data);
    }

    static initialise() {
        if (!DamageRoll) {
            ui.notifications.error(this.localize("damage-roll-not-found"));
        }

        // Update the Thermal Nimbus stance to add the new damage effect
        Hooks.on(
            "preCreateItem",
            item => {
                if (item.sourceId == THERMAL_NIMBUS_STANCE_ID) {
                    const auraRule = item._source.system.rules.find(rule => rule.key === "Aura");
                    auraRule.effects.push(
                        {
                            "affects": "enemies",
                            "events": ["enter"],
                            "uuid": THERMAL_NIMBUS_DAMAGE_EFFECT_ID
                        }
                    );
                }
            }
        );

        // When a new turn begins, check if the combatant whose turn has just started is affected by Thermal Nimbus, and roll damage
        Hooks.on(
            "combatTurnChange",
            (encounter, previousState, currentState) => {
                // If we've gone back a turn, skip processing
                if (currentState.round < previousState.round || (currentState.round == previousState.round && currentState.turn < previousState.turn)) {
                    return;
                }

                const actor = encounter.combatant?.actor;
                if (!actor) {
                    return;
                }

                const token = encounter.combatant?.token;
                if (!token) {
                    return;
                }

                const thermalNimbusDamageEffect = actor.itemTypes.effect.find(effect => effect.sourceId === THERMAL_NIMBUS_DAMAGE_EFFECT_ID);
                if (!thermalNimbusDamageEffect) {
                    return;
                }

                this.#rollThermalNimbusDamage(thermalNimbusDamageEffect, token);
            }
        );

        // If a token receives the Thermal Nimbus Damage effect on its turn, it must have moved into the aura, so roll damage
        Hooks.on(
            "createItem",
            item => {
                if (item.sourceId != THERMAL_NIMBUS_DAMAGE_EFFECT_ID) {
                    return;
                }

                const actor = item.actor;
                if (!actor) {
                    return;
                }

                const token = actor.token;
                if (!token) {
                    return;
                }

                if (game.combat?.current?.tokenId === token.id) {
                    this.#rollThermalNimbusDamage(item, token);
                }
            }
        );

        // When a thermal nimbus damage roll message is created, apply that damage to the target
        Hooks.on(
            "createChatMessage",
            message => {
                const flags = message.flags["pf2e-kineticists-companion"]?.["thermal-nimbus-damage"];
                if (!flags) {
                    return;
                }

                if (!game.settings.get("pf2e-kineticists-companion", "thermal-nimbus-apply-damage")) {
                    return;
                }

                const tokenId = flags["target-token-id"];
                const token = game.combat?.combatants?.map(combatant => combatant.token)?.find(token => token.id === tokenId);
                if (!token) {
                    return;
                }

                const actor = token.actor;
                if (!actor) {
                    return;
                }

                // Only the actor's primary updater should apply the damage
                if (actor.primaryUpdater != game.user) {
                    return;
                }

                actor.applyDamage(
                    {
                        damage: message.rolls[0],
                        token,
                        item: message.item,
                        rollOptions: new Set(
                            [
                                ...message.flags?.pf2e?.context?.options?.map(option => option.replace(/^self:/, "origin:")) ?? [],
                                ...actor.getRollOptions()
                            ]
                        )
                    }
                );
            }
        );
    }

    static async #rollThermalNimbusDamage(thermalNimbusDamageEffect, token) {
        const originActor = thermalNimbusDamageEffect.origin;
        if (!originActor) {
            return;
        }

        // The origin actor's primary updater should be posting the damage.
        if (originActor.primaryUpdater != game.user) {
            return;
        }

        const thermalNimbusFeat = originActor.itemTypes.feat.find(feat => feat.sourceId === THERMAL_NIMBUS_FEAT_ID);
        if (!thermalNimbusFeat) {
            return;
        }

        new DamageRoll(
            "(floor(@actor.level/2))[@actor.flags.pf2e.kineticist.thermalNimbus]",
            {
                actor: originActor,
                item: thermalNimbusFeat
            }
        )
            .toMessage(
                {
                    speaker: ChatMessage.getSpeaker({ actor: originActor }),
                    flavor: await this.#buildMessageFlavour(thermalNimbusFeat),
                    flags: {
                        "pf2e": {
                            context: {
                                type: "damage-roll",
                                actor: originActor.id,
                                domains: ["damage"],
                                traits: thermalNimbusFeat.system.traits.value,
                                options: [
                                    ...thermalNimbusFeat.system.traits.value,
                                    ...originActor.getRollOptions(),
                                    ...thermalNimbusFeat.getRollOptions("item")
                                ]
                            },
                            origin: thermalNimbusFeat.getOriginData()
                        },
                        "pf2e-kineticists-companion": {
                            "thermal-nimbus-damage": {
                                "target-token-id": token.id
                            }
                        }
                    }
                }
            );
    }

    static async #buildMessageFlavour(thermalNimbusFeat) {
        let flavor = await renderTemplate(
            "systems/pf2e/templates/chat/action/header.hbs",
            {
                title: thermalNimbusFeat.name,
                glyph: "",
            }
        );

        const traits = thermalNimbusFeat.system.traits.value
            .map(s => ({ value: s, label: game.i18n.localize(CONFIG.PF2E.actionTraits[s] ?? "") }))
            .sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang))
            .map(
                tag => {
                    const description = CONFIG.PF2E.traitsDescriptions[tag.value] ?? "";

                    const span = document.createElement("span");
                    span.className = "tag";
                    span.dataset["trait"] = tag.value;
                    if (description) {
                        span.dataset.tooltip = description;
                    }
                    span.innerText = tag.label;

                    return span.outerHTML;
                }
            )
            .join("");

        const div = document.createElement("div");
        div.classList.add("tags");
        div.dataset["tooltipClass"] = "pf2e";

        div.innerHTML = traits;
        flavor += div.outerHTML;
        flavor += "\n<hr />";

        return flavor;
    }
}
