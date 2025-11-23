const CONFIG = {
    difficulties: [
        { id: "hard", label: "Entry Level", pay: 1440 },
        { id: "med", label: "Mid-Career", pay: 2160 },
        { id: "easy", label: "Senior", pay: 2880 },
    ],
    housing: [
        { id: "shared", label: "Shared Room", cost: 350, qolPerRound: -2 },
        { id: "apt", label: "1BR Apt", cost: 800, qolPerRound: 0 },
        { id: "lux", label: "Luxury Loft", cost: 1100, qolPerRound: 3 },
    ],
};

const VAR_RULES = {
    food: {
        title: "Food",
        base: 120,
        max: 200,
        qolBoostMax: 8,
    },
    entertainment: {
        title: "Entertainment",
        base: 60,
        max: 180,
        qolBoostMax: 10,
    },
};

const WINTER_ROUNDS = new Set([1, 2, 3, 4, 22, 23, 24, 25, 26]);

let state = {
    round: 1,
    cash: 0,
    debt: 0,
    qol: 50,
    savings: 0,
    debtRecords: [],
    coverage: { health: false },
    flags: {
        rentHiked: false,
        sideHustleUnlocked: false,
        bootcampDone: false,
        dentalMisses: 0,
        dentalBombPending: false,
        layoffRoundsLeft: 0,
        lastPerformanceReview: 0,
    },
    eventLog: [],
    job: null,
    home: null,
    cards: [],
    lastLog: [],
    lastLogRound: null,
    variableTracker: {
        food: { missedRounds: 0 },
        entertainment: { missedRounds: 0 },
    },
    homeLogThisRound: null,
};

function isWinter(round) {
    const r = ((round - 1) % 26) + 1;
    return WINTER_ROUNDS.has(r);
}

function adjustQoL(delta) {
    state.qol = Math.max(0, Math.min(100, state.qol + delta));
}

function ageCards() {
    state.cards = state.cards
        .map((c) => {
            if (c.meta?.debtCard) return c;
            return {
                ...c,
                roundsLeft: (c.roundsLeft || 1) - 1,
            };
        })
        .filter((c) => c.meta?.debtCard || c.roundsLeft > 0);
}

// --- DEBT HELPERS ---
function syncDebtCardAmount() {
    const debtCard = state.cards.find((c) => c.meta?.debtCard);
    if (!debtCard) return;
    const paid = debtCard.payments.reduce((sum, p) => sum + p.amount, 0);
    debtCard.amount = state.debt + paid;
    debtCard.roundsLeft = 9999;
}

function recordDebt(amount, reason, meta = {}) {
    state.debt += amount;
    state.debtRecords.push({
        id: Date.now() + Math.random(),
        amount,
        reason,
        ...meta,
    });
    syncDebtCardAmount();
}

function removeDebtRecordByPaymentId(paymentId) {
    let idx = state.debtRecords.findIndex((d) => d.paymentId === paymentId);
    if (idx !== -1) {
        state.debt -= state.debtRecords[idx].amount;
        state.debtRecords.splice(idx, 1);
    }
}

// --- INIT ---
function init() {
    const dContainer = document.getElementById("diff-options");
    CONFIG.difficulties.forEach((d) => {
        dContainer.innerHTML += `<div class="select-card" onclick="setDiff('${d.id}')"><h3>${d.label}</h3><p>$${d.pay}</p></div>`;
    });
}

function setDiff(id) {
    state.job = CONFIG.difficulties.find((d) => d.id === id);
    document.getElementById("setup-step-1").classList.add("hidden");
    document.getElementById("setup-step-2").classList.remove("hidden");

    const hContainer = document.getElementById("housing-options");
    CONFIG.housing.forEach((h) => {
        hContainer.innerHTML += `<div class="select-card" onclick="setHousing('${h.id}')"><h3>${h.label}</h3><p>$${h.cost}</p></div>`;
    });
}

function setHousing(id) {
    state.home = CONFIG.housing.find((h) => h.id === id);
    document.getElementById("setup-modal").classList.add("hidden");
    state.cash = 500;
    startRound();
}

// --- ROUND LOGIC ---
function startRound() {
    if (state.flags.layoffRoundsLeft > 0) {
        state.flags.layoffRoundsLeft -= 1;
        showToast("Layoff: No paycheck this round.");
    } else {
        state.cash += state.job.pay;
        showToast(`Payday! +$${state.job.pay}`);
    }
    ageCards();
    generateCards();
    triggerEvents();
    renderAll();
}

const OPP_UNLOCK_ROUND = 4;
const EVENT_UNLOCK_ROUND = 6;

function hasActiveCard(title) {
    return state.cards.some((c) => c.title === title);
}

function generateCards() {
    // Fixed cards stick around for two rounds
    if (state.round % 4 === 1 && !hasActiveCard("Rent"))
        addCard("fixed", "Rent", state.home.cost, false, {
            roundsLeft: 2,
        });
    if (state.round % 4 === 1 && !hasActiveCard("Utilities"))
        addCard("fixed", "Utilities", 120, false, { roundsLeft: 2 });
    if (state.round % 4 === 1 && !hasActiveCard("Car Payment"))
        addCard("fixed", "Car Payment", 300, false, {
            note: "Monthly auto loan.",
            roundsLeft: 2,
        });

    // Debt payoff card (persists while debt exists)
    if (state.debt > 0) {
        const debtCard = state.cards.find((c) => c.meta?.debtCard);
        if (debtCard) {
            syncDebtCardAmount();
        } else {
            addCard("fixed", "Debt Balance", state.debt, false, {
                note: "Pay with cash to reduce your debt.",
                roundsLeft: 9999,
                meta: { debtCard: true },
            });
        }
    } else {
        state.cards = state.cards.filter((c) => !(c.meta && c.meta.debtCard));
    }

    // Variable cards (per-round)
    addCard("var", "Groceries", 200, false, {
        meta: {
            category: "food",
            base: VAR_RULES.food.base,
            max: VAR_RULES.food.max,
        },
    });
    addCard("var", "Fun / Entertainment", 100, false, {
        meta: {
            category: "entertainment",
            base: VAR_RULES.entertainment.base,
            max: VAR_RULES.entertainment.max,
        },
    });
    addCard("var", "Gas & Transit", 120);
    addCard("var", "Dining Out", 120, true, {
        meta: { category: "food" },
    });

    // Goals
    addCard("goal", "Emergency Fund / Savings", 100, true);
    addCard("goal", "Vacation Fund", 50, true);
    addCard("goal", "Retirement Contribution", 150, true, {
        note: "Long-term benefit; optional contribution.",
    });

    // Opportunities (unlocked after a few rounds)
    if (state.round >= OPP_UNLOCK_ROUND) {
        if (state.round % 3 === 1) {
            addCard("opp", "Dental Checkup", 80, true, {
                note: "Small cost now to avoid big dental bill later.",
                trackKey: "dentalCheck",
            });
        }

        if (!state.coverage.health) {
            addCard("opp", "Enroll: Health Insurance", 150, true, {
                note: "Pay once to unlock health coverage; monthly premiums will appear.",
                onPaid: () => {
                    state.coverage.health = true;
                    showToast("Health insurance activated. Premium will recur.");
                },
            });
        } else if (!hasActiveCard("Health Insurance Premium")) {
            addCard("fixed", "Health Insurance Premium", 150, false, {
                note: "Keeps medical events cheaper.",
                roundsLeft: 2,
            });
        }

        if (!state.flags.bootcampDone && state.round > 4) {
            addCard("opp", "Skill Bootcamp", 300, true, {
                note: "Invest in skills; raises salary ~10%.",
                onPaid: () => {
                    state.flags.bootcampDone = true;
                    state.job.pay = Math.round(state.job.pay * 1.1);
                    adjustQoL(-3);
                    showToast("Bootcamp complete! Salary bumped.");
                },
            });
        }

        if (state.round % 6 === 1) {
            addCard("opp", "Ask for a Raise", 1, true, {
                note: "Drop a $1 bill to try for +5-10% salary.",
                onPaid: () => {
                    const delta = Math.random() < 0.5 ? 0.05 : 0.1;
                    state.job.pay = Math.round(state.job.pay * (1 + delta));
                    adjustQoL(-1);
                    showToast("Negotiation paid off with a raise!");
                },
            });
        }

        if (!state.flags.sideHustleUnlocked && state.round > 2) {
            addCard("opp", "Start a Side Hustle", 200, true, {
                note: "Upfront setup. Unlocks future shift card (+$150, QoL -2).",
                onPaid: () => {
                    state.flags.sideHustleUnlocked = true;
                    adjustQoL(-2);
                    showToast("Side hustle unlocked.");
                },
            });
        } else if (state.flags.sideHustleUnlocked) {
            addCard("opp", "Take a Side Hustle Shift", 1, true, {
                note: "Drop a $1 bill to spend time. Gain $150, QoL -2.",
                onPaid: () => {
                    state.cash += 150;
                    adjustQoL(-2);
                    showToast("Side hustle shift paid $150.");
                },
            });
        }
    }

    if (state.flags.dentalBombPending) {
        addCard("event", "Dental Time Bomb", 800, false, {
            note: "Skipping checkups caught up to you.",
            debtOnMiss: 800,
        });
        adjustQoL(-3);
        state.flags.dentalBombPending = false;
    }

    if (state.round >= EVENT_UNLOCK_ROUND && Math.random() > 0.7)
        addCard("event", "Speeding Ticket", 150, false, {
            note: "Pay promptly or it becomes debt.",
            debtOnMiss: 150,
        });
}

function addCard(type, title, amount, optional = false, options = {}) {
    state.cards.push({
        id: Date.now() + Math.random(),
        type,
        title,
        amount,
        payments: [], // Track specific bills dropped here
        optional,
        note: options.note || "",
        onPaid: options.onPaid || null,
        fulfilled: false,
        debtOnMiss: options.debtOnMiss || null,
        trackKey: options.trackKey || null,
        roundsLeft: options.roundsLeft || 1,
        meta: options.meta || null,
    });
}

function triggerEvents() {
    // Placeholder for future event deck hooks; currently events are added during generateCards.
}

// --- DRAG & DROP & UNDO ---
function drag(ev) {
    ev.dataTransfer.setData("val", ev.target.dataset.val);
    ev.dataTransfer.setData("type", ev.target.dataset.type);
}

function allowDrop(ev) {
    ev.preventDefault();
    ev.currentTarget.classList.add("hover");
}
function leaveDrop(ev) {
    ev.currentTarget.classList.remove("hover");
}

function drop(ev, cardId) {
    ev.preventDefault();
    ev.currentTarget.classList.remove("hover");

    let card = state.cards.find((c) => c.id == cardId);
    let valStr = ev.dataTransfer.getData("val");
    let type = ev.dataTransfer.getData("type");

    // Calculate current total paid and cap for variable spending
    const cap = card.meta?.max ?? card.amount;
    let currentPaid = card.payments.reduce((sum, p) => sum + p.amount, 0);
    let remaining = Math.max(0, cap - currentPaid);

    if (remaining <= 0) {
        showToast("You've already maxed this out for the round.");
        return;
    }

    let amount = 0;

    if (type === "credit") {
        if (card.type === "goal") {
            showToast("Can't save with credit!");
            return;
        }
        amount = remaining; // Credit pays full remainder
    } else {
        amount = parseInt(valStr);
        amount = Math.min(amount, remaining);
        if (state.cash < amount) {
            showToast("Not enough cash!");
            return;
        }
        state.cash -= amount;
    }

    if (!amount || amount <= 0) {
        showToast("Drop a bill to pay.");
        return;
    }

    // ADD PAYMENT TO STACK (The Undo Hook)
    const paymentId = Date.now();
    card.payments.push({
        id: paymentId,
        amount: amount,
        type: type,
    });

    let newPaidTotal = card.payments.reduce((sum, p) => sum + p.amount, 0);

    if (type === "credit") {
        recordDebt(amount, `Credit used on ${card.title}`, { paymentId });
    }

    if (card.type === "goal") {
        state.savings += amount;
    }

    if (card.meta?.debtCard) {
        if (type === "credit") {
            showToast("Can't pay debt with more debt.");
            card.payments.pop();
            removeDebtRecordByPaymentId(paymentId);
            renderAll();
            return;
        }
        state.debt = Math.max(0, state.debt - amount);
        syncDebtCardAmount();
        if (state.debt <= 0) {
            state.cards = state.cards.filter((c) => !(c.meta && c.meta.debtCard));
        }
    }

    if (card.onPaid && !card.fulfilled && newPaidTotal >= card.amount) {
        card.fulfilled = true;
        try {
            card.onPaid(card);
        } catch (e) {
            console.error("onPaid handler failed", e);
        }
    }

    renderAll();
}

function payFull(cardId) {
    const card = state.cards.find((c) => c.id == cardId);
    if (!card) return;

    const cap = card.meta?.max ?? card.amount;
    const paidSoFar = card.payments.reduce((sum, p) => sum + p.amount, 0);
    const remaining = Math.max(0, cap - paidSoFar);
    if (remaining <= 0) {
        showToast("This card is already maxed out for now.");
        return;
    }

    const paymentId = Date.now();
    let paymentType = "cash";

    if (state.cash >= remaining) {
        state.cash -= remaining;
    } else {
        if (card.type === "goal" || card.meta?.debtCard) {
            showToast("Not enough cash to finish this goal.");
            return;
        }
        paymentType = "credit";
        recordDebt(remaining, `Credit used on ${card.title}`, { paymentId });
    }

    card.payments.push({
        id: paymentId,
        amount: remaining,
        type: paymentType,
    });

    if (card.type === "goal") {
        state.savings += remaining;
    }

    if (card.meta?.debtCard) {
        state.debt = Math.max(0, state.debt - remaining);
        syncDebtCardAmount();
        if (state.debt <= 0) {
            state.cards = state.cards.filter((c) => !(c.meta && c.meta.debtCard));
        }
    }

    const newPaidTotal = card.payments.reduce((sum, p) => sum + p.amount, 0);
    if (card.onPaid && !card.fulfilled && newPaidTotal >= card.amount) {
        card.fulfilled = true;
        try {
            card.onPaid(card);
        } catch (e) {
            console.error("onPaid handler failed", e);
        }
    }

    renderAll();
}

// NEW: Undo Function
function removePayment(cardId, paymentId) {
    let card = state.cards.find((c) => c.id == cardId);
    let payIdx = card.payments.findIndex((p) => p.id == paymentId);

    if (payIdx === -1) return;

    let payment = card.payments[payIdx];

    // Refund
    if (payment.type === "credit") {
        removeDebtRecordByPaymentId(payment.id);
    } else {
        state.cash += payment.amount;
    }

    if (card.type === "goal") {
        state.savings -= payment.amount;
    }

    // Remove from stack
    card.payments.splice(payIdx, 1);

    renderAll();
}

// --- RENDER ---
function renderAll() {
    updateHeader();
    ["fixed", "var", "goal", "event", "opp"].forEach((t) => {
        document.getElementById(`col-${t}-content`).innerHTML = "";
        document.getElementById(`count-${t}`).innerText = `(${
            state.cards.filter((c) => c.type === t).length
        })`;
    });

    state.cards.forEach((card) => {
        let paid = card.payments.reduce((sum, p) => sum + p.amount, 0);
        const maxTarget = card.meta?.max ?? card.amount;
        const baseTarget = card.meta?.base ?? card.amount;
        const isVariable = card.type === "var";
        let progress = Math.min(100, (paid / maxTarget) * 100);
        let isDone = isVariable ? paid >= baseTarget : paid >= card.amount;
        const hideDrop = isVariable ? paid >= maxTarget : isDone;

        const displayAmount = isVariable ? `Up to $${maxTarget}` : `$${card.amount}`;
        const footerText = isVariable
            ? isDone
                ? `QoL covered (spent $${paid})`
                : `$${Math.max(0, baseTarget - paid)} until QoL holds`
            : isDone
              ? "Paid!"
              : `$${Math.max(0, card.amount - paid)} left`;

        // Generate Mini-Bills HTML
        let stackHtml = card.payments
            .map((p) => {
                let colorClass = "";
                if (p.type === "credit") colorClass = "card-credit";
                else if (p.amount === 100) colorClass = "bill-100";
                else if (p.amount === 50) colorClass = "bill-50";
                else if (p.amount === 10) colorClass = "bill-10";
                else colorClass = "bill-1";

                return `<div class="mini-bill ${colorClass}" onclick="removePayment(${
                    card.id
                }, ${p.id})">
                        ${p.type === "credit" ? "Cred" : "$" + p.amount}
                    </div>`;
            })
            .join("");

        let html = `
            <div class="game-card ${card.type} ${isDone ? "paid-full" : ""}">
                <div class="card-top">
                    <span class="card-title">${card.title}</span>
                    <span style="font-weight:bold">${displayAmount}</span>
                </div>
                ${
                    card.note ? `<div class="card-note">${card.note}</div>` : ""
                }
                
                ${
                    !hideDrop
                        ? `
                <div class="drop-zone" ondrop="drop(event, ${card.id})" ondragover="allowDrop(event)" ondragleave="leaveDrop(event)">
                    Drop Here
                </div>
                <button class="payfull-btn" onclick="payFull(${card.id})">
                    Pay Full
                </button>`
                        : ""
                }

                ${
                    isVariable
                        ? `<div style="font-size:0.8rem; color:#777; margin-top:6px;">
                            Base $${baseTarget} keeps QoL steady; up to $${maxTarget} gives smaller boosts.
                           </div>`
                        : ""
                }

                <div class="payment-stack">
                    ${stackHtml}
                </div>

                <div class="card-progress">
                    <div class="card-progress-bar" style="width: ${progress}%"></div>
                </div>
                <div style="text-align:right; font-size:0.8rem; margin-top:4px; color:#666;">
                    ${footerText}
                </div>
            </div>
        `;
        document.getElementById(`col-${card.type}-content`).innerHTML += html;
    });
    renderLog();
}

function updateHeader() {
    document.getElementById("ui-round").innerText = state.round;
    document.getElementById("ui-cash").innerText = `$${state.cash}`;
    document.getElementById("ui-debt").innerText = `$${state.debt}`;
    document.getElementById("ui-debt-count").innerText = `(${state.debtRecords.length})`;
    document.getElementById("debt-badge").title =
        state.debtRecords.length === 0
            ? "No debt currently"
            : state.debtRecords.map((d) => `${d.reason}: $${d.amount}`).join("\n");
    document.getElementById("ui-savings").innerText = `$${state.savings}`;
    document.getElementById("ui-qol").innerText = state.qol;
}

function renderLog() {
    const list = document.getElementById("recap-list");
    const roundLabel = document.getElementById("recap-round");

    if (!state.lastLogRound || state.lastLog.length === 0) {
        list.innerHTML = `<li class="recap-empty">Finish a round to see the cause-and-effect story.</li>`;
        roundLabel.innerText = "-";
        return;
    }

    roundLabel.innerText = state.lastLogRound;
    list.innerHTML = state.lastLog
        .map(
            (msg) => `
                    <li class="recap-item">
                        <span class="recap-dot"></span>
                        <span>${msg}</span>
                    </li>`,
        )
        .join("");
}

function openRecap() {
    const modal = document.getElementById("recap-modal");
    renderLog();
    modal.classList.add("show");
}

function closeRecap() {
    const modal = document.getElementById("recap-modal");
    modal.classList.remove("show");
}

function buildRoundLog(unpaidFixed, extraLogs = []) {
    const log = [];
    let totalCredit = 0;

    state.cards.forEach((card) => {
        const paid = card.payments.reduce((sum, p) => sum + p.amount, 0);
        const creditPaid = card.payments
            .filter((p) => p.type === "credit")
            .reduce((sum, p) => sum + p.amount, 0);
        const remaining = Math.max(0, card.amount - paid);

        totalCredit += creditPaid;

        // Variable expenses are handled separately in variableOutcome logging.
        if (card.type === "var") {
            return;
        }

        if (paid >= card.amount) {
            if (creditPaid > 0) {
                log.push(
                    `Because you put $${creditPaid} of ${card.title} on credit, your debt grew and interest can pile up.`,
                );
            } else {
                log.push(
                    `Because you paid ${card.title} in full, you avoided fees and protected your credit score.`,
                );
            }

            if (card.title.toLowerCase().includes("emergency fund")) {
                log.push(
                    "Because you built your emergency fund, a surprise won't wreck your credit.",
                );
            }
        } else {
            if (card.optional) {
                log.push(
                    `Because you skipped ${card.title.toLowerCase()}, you're still exposed if something goes wrong.`,
                );
            } else {
                log.push(
                    `Because you skipped ${card.title.toLowerCase()}, $${remaining} will follow you and can trigger penalties.`,
                );
            }
        }
    });

    unpaidFixed.forEach((card) => {
        const paid = card.payments.reduce((sum, p) => sum + p.amount, 0);
        const missed = card.amount - paid;
        const penalty = missed + 50;
        log.push(
            `Because you missed ${card.title.toLowerCase()}, debt jumped by $${penalty} ($${missed} bill + $50 penalty) and QoL dropped.`,
        );
    });

    if (totalCredit > 0) {
        log.push(
            `Because you used credit this round, your balance grew by $${totalCredit}; paying it off soon avoids interest.`,
        );
    }

    return log.concat(extraLogs);
}

function getSpendForCategory(category) {
    return state.cards
        .filter((c) => c.meta && c.meta.category === category)
        .reduce(
            (sum, card) =>
                sum + card.payments.reduce((s, p) => s + p.amount, 0),
            0,
        );
}

function calcBoost(spend, maxSpend, maxBoost) {
    if (spend <= 0) return 0;
    const ratio = Math.min(1, spend / maxSpend);
    return Math.round(maxBoost * Math.sqrt(ratio));
}

function processVariableSpending() {
    const effects = [];
    let qolDelta = 0;

    const categories = [
        { key: "food", rules: VAR_RULES.food },
        { key: "entertainment", rules: VAR_RULES.entertainment },
    ];

    categories.forEach(({ key, rules }) => {
        const spend = getSpendForCategory(key);
        const tracker = state.variableTracker[key];
        const base = rules.base;
        const max = rules.max;

        if (spend >= base) {
            tracker.missedRounds = 0;
            const boost = calcBoost(spend, max, rules.qolBoostMax);
            if (boost > 0) {
                qolDelta += boost;
                effects.push(
                    `Because you spent $${spend} on ${rules.title.toLowerCase()}, QoL rose by ${boost} (diminishing returns).`,
                );
            } else {
                effects.push(
                    `Because you covered ${rules.title.toLowerCase()}, QoL held steady.`,
                );
            }
        } else {
            tracker.missedRounds += 1;
            const short = Math.max(0, base - spend);
            let penalty = 0;

            if (key === "food") {
                penalty = Math.min(15, 6 + tracker.missedRounds * 5);
            } else {
                // Entertainment tolerates one light round before slipping
                penalty =
                    tracker.missedRounds >= 2
                        ? Math.min(12, 3 * (tracker.missedRounds - 1) + 1)
                        : 0;
            }

            if (penalty > 0) {
                qolDelta -= penalty;
                effects.push(
                    `Because you underfunded ${rules.title.toLowerCase()} for ${tracker.missedRounds} round(s), QoL fell by ${penalty}.`,
                );
            } else {
                effects.push(
                    `Because you spent only $${spend} on ${rules.title.toLowerCase()}, QoL didn't improve; wait too long and it will drop.`,
                );
            }
        }
    });

    return { effects, qolDelta };
}

function nextRound() {
    const debtCards = state.cards.filter((c) => {
        const paid = c.payments.reduce((s, p) => s + p.amount, 0);
        return (
            paid < c.amount &&
            (c.type === "fixed" || c.debtOnMiss !== null) &&
            (c.roundsLeft || 1) <= 1
        );
    });

    if (debtCards.length > 0) {
        if (
            !confirm(
                "You have unpaid expenses that will become debt + penalties. Continue?",
            )
        )
            return;
        debtCards.forEach((c) => {
            const paid = c.payments.reduce((s, p) => s + p.amount, 0);
            const baseOwed = c.amount - paid;
            const debtAdd = c.debtOnMiss !== null ? c.debtOnMiss : baseOwed + 50;
            const reason =
                c.type === "fixed"
                    ? `Unpaid ${c.title} (includes $50 penalty)`
                    : `Unpaid ${c.title} moved to debt`;
            recordDebt(debtAdd, reason, { cardId: c.id });
            adjustQoL(c.type === "fixed" ? -5 : -3);
        });
    }

    // Variable spending QoL effects
    const variableOutcome = processVariableSpending();
    adjustQoL(variableOutcome.qolDelta);

    // Preventive care tracking
    const dentalCard = state.cards.find((c) => c.trackKey === "dentalCheck");
    if (dentalCard) {
        const paid = dentalCard.payments.reduce((s, p) => s + p.amount, 0);
        if (paid >= dentalCard.amount) {
            state.flags.dentalMisses = 0;
        } else {
            state.flags.dentalMisses += 1;
            if (state.flags.dentalMisses >= 2) {
                state.flags.dentalBombPending = true;
                state.flags.dentalMisses = 0;
            }
        }
    }

    const finishingRound = state.round;
    const roundLog = buildRoundLog(
        debtCards.filter((c) => c.type === "fixed"),
        variableOutcome.effects,
    );
    state.lastLog = roundLog;
    state.lastLogRound = finishingRound;
    state.homeLogThisRound = null;

    state.round += 2;
    if (state.round > 26) {
        alert("Game Over! Quality of Life: " + state.qol);
        location.reload();
    } else startRound();
}

function showToast(msg) {
    const t = document.getElementById("toast");
    t.innerText = msg;
    t.style.opacity = 1;
    setTimeout(() => (t.style.opacity = 0), 2000);
}

init();
