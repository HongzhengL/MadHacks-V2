const CONFIG = {
    difficulties: [
        { id: "hard", label: "Entry Level", pay: 1100 },
        { id: "med", label: "Mid-Career", pay: 1900 },
        { id: "easy", label: "Senior", pay: 3800 },
    ],
    housing: [
        { id: "shared", label: "Shared Room", cost: 1000, qolPerRound: -2 },
        { id: "apt", label: "1BR Apartment", cost: 1600, qolPerRound: 0 },
        { id: "lux", label: "Luxury Loft", cost: 2000, qolPerRound: 3 },
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
const SUMMER_ROUNDS = new Set([10, 11, 12, 13, 14, 15, 16]);
const ROUNDS_PER_YEAR = 26;
const SAVINGS_RATES = {
    emergency: 0.0001 / ROUNDS_PER_YEAR, // 0.01% APY
    hysa: 0.035 / ROUNDS_PER_YEAR, // 3.5% APY
    vacation: 0.035 / ROUNDS_PER_YEAR, // Match HYSA feel
};
const RETIREMENT_BASE_APY = 0.09;
const RETIREMENT_VOLATILITY = { min: -0.25, max: 1.5 };
const EMPLOYER_MATCH = { percent: 0.5, capPerRound: 75 };

let state = {
    round: 1,
    cash: 0,
    debt: 0,
    qol: 50,
    savings: {
        emergency: 0,
        hysa: 0,
        vacation: 0,
        retirement: 0,
        other: 0,
    },
    retirementMatchThisRound: 0,
    lastMarketFactor: 1,
    scheduledWithdrawals: [],
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
        slipRecoveryRounds: 0,
        burnoutRisk: 0,
        layoffRisk: 0,
        marketHabitActive: false,
        offeredVictory: false,
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
    gameOver: false,
    pendingRoundStart: false,
    pendingEndgame: false,
};
let contextMenuOptions = [];
let withdrawContext = null;

function isWinter(round) {
    const r = ((round - 1) % 26) + 1;
    return WINTER_ROUNDS.has(r);
}

function isSummer(round) {
    const r = ((round - 1) % 26) + 1;
    return SUMMER_ROUNDS.has(r);
}

function adjustQoL(delta) {
    state.qol = Math.max(0, Math.min(100, state.qol + delta));
    if (state.qol <= 0) {
        handleGameOver("Game Over: Your Quality of Life hit zero.");
    }
}

function handleGameOver(message) {
    if (state.gameOver) return;
    state.gameOver = true;
    alert(message);
    location.reload();
}

function savingsTotal() {
    return (
        (state.savings.emergency || 0) +
        (state.savings.hysa || 0) +
        (state.savings.vacation || 0) +
        (state.savings.retirement || 0) +
        (state.savings.other || 0)
    );
}

function adjustSavings(type, delta) {
    if (!state.savings[type]) state.savings[type] = 0;
    state.savings[type] = Math.max(0, state.savings[type] + delta);
}

function savingsBalance(type) {
    return state.savings[type] || 0;
}

function liquidSavingsTotal() {
    return (
        (state.savings.emergency || 0) +
        (state.savings.hysa || 0) +
        (state.savings.vacation || 0)
    );
}

function nestEggTotal() {
    return state.savings.retirement || 0;
}

function liquidityTotal() {
    return state.cash + liquidSavingsTotal();
}

function netWorthTotal() {
    return liquidityTotal() + nestEggTotal() - state.debt;
}

function retirementFutureStatus(balance) {
    if (balance >= 4000) {
        return "Status: Early retirement at 55!";
    }
    if (balance >= 2000) {
        return "Status: On track for 65.";
    }
    if (balance >= 500) {
        return "Status: Comfortable but keep investing.";
    }
    return "Status: You will be working until you are 82.";
}

function monthlyFixedEstimate() {
    const baseHousing = state.home?.cost || 0;
    const utilities = 50;
    const car = 750;
    const studentLoan = 200;
    const health = state.coverage.health ? 150 : 0;
    return baseHousing + utilities + car + studentLoan + health;
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
    const salaryDisplay = { hard: 30000, med: 50000, easy: 100000 };
    CONFIG.difficulties.forEach((d) => {
        const annual = salaryDisplay[d.id] || d.pay * 26;
        dContainer.innerHTML += `<div class="select-card" onclick="setDiff('${
            d.id
        }')"><h3>${d.label}</h3><p>$${annual.toLocaleString()} a year ($${
            d.pay
        } per paycheck)</p></div>`;
    });
}

function setDiff(id) {
    state.job = CONFIG.difficulties.find((d) => d.id === id);
    document.getElementById("setup-step-1").classList.add("hidden");
    document.getElementById("setup-step-2").classList.remove("hidden");

    const hContainer = document.getElementById("housing-options");
    CONFIG.housing.forEach((h) => {
        hContainer.innerHTML += `<div class="select-card" onclick="setHousing('${h.id}')"><h3>${h.label}</h3><p>$${h.cost} per month</p></div>`;
    });
}

function setHousing(id) {
    state.home = CONFIG.housing.find((h) => h.id === id);
    document.getElementById("setup-modal").classList.add("hidden");
    state.cash = 500;
    startRound();
}

function processScheduledWithdrawals() {
    const arriving = [];
    state.scheduledWithdrawals = state.scheduledWithdrawals.filter((w) => {
        if (state.round >= w.roundDue) {
            arriving.push(w);
            return false;
        }
        return true;
    });
    arriving.forEach((w) => {
        state.cash += w.amount;
        showToast(`$${w.amount} from ${w.source} landed in your balance.`);
    });
}

function transferGoalBalancesToSavings() {
    const clearGoalPayments = (type) => {
        state.cards
            .filter((c) => c.meta?.savingsType === type)
            .forEach((c) => (c.payments = []));
    };

    const transfers = [];
    let totalToEmergency = 0;

    // Vacation savings stay in their own HYSA-like bucket; just clear the UI stack.
    const vacationBal = savingsBalance("vacation");
    if (vacationBal > 0) {
        clearGoalPayments("vacation");
        transfers.push({
            type: "vacation",
            amount: vacationBal,
            destination: "vacation",
        });
    } else {
        clearGoalPayments("vacation");
    }

    // Retirement savings stay locked in their own silo; just clear the UI stack.
    const retirementBal = savingsBalance("retirement");
    if (retirementBal > 0) {
        clearGoalPayments("retirement");
        transfers.push({
            type: "retirement",
            amount: retirementBal,
            destination: "retirement",
        });
    } else {
        clearGoalPayments("retirement");
    }

    if (totalToEmergency > 0) {
        adjustSavings("emergency", totalToEmergency);
    }

    return transfers;
}

// Sweep any leftover cash into emergency savings at round end.
function sweepCashToEmergency() {
    const leftover = Math.max(0, Math.floor(state.cash));
    if (leftover <= 0) return 0;

    adjustSavings("emergency", leftover);
    state.cash = 0;
    return leftover;
}

function randomMarketFactor() {
    const span = RETIREMENT_VOLATILITY.max - RETIREMENT_VOLATILITY.min;
    const factor = RETIREMENT_VOLATILITY.min + Math.random() * span;
    state.lastMarketFactor = factor;
    return factor;
}

function maybeApplyEmployerMatch(payment) {
    if (payment.savingsType !== "retirement") return 0;
    if (payment.type !== "cash") return 0;

    const capLeft = EMPLOYER_MATCH.capPerRound - state.retirementMatchThisRound;
    if (capLeft <= 0) return 0;

    const match = Math.min(
        capLeft,
        Math.round(payment.amount * EMPLOYER_MATCH.percent),
    );
    if (match > 0) {
        adjustSavings("retirement", match);
        state.retirementMatchThisRound += match;
        showToast(`Employer matched $${match}! (Free Money)`);
    }
    return match;
}

function applySavingsInterest() {
    const earned = [];
    const emerg = state.savings.emergency || 0;
    const hysa = state.savings.hysa || 0;
    const vacation = state.savings.vacation || 0;
    const retirementBal = state.savings.retirement || 0;
    const emergGain = Math.floor(emerg * SAVINGS_RATES.emergency);
    const hysaGain = Math.floor(hysa * SAVINGS_RATES.hysa);
    const vacationGain = Math.floor(
        vacation * SAVINGS_RATES.vacation,
    );
    let retirementGain = 0;
    let marketMood = null;

    if (emergGain > 0) {
        adjustSavings("emergency", emergGain);
        earned.push(`$${emergGain} in Emergency Fund interest`);
    }
    if (hysaGain > 0) {
        adjustSavings("hysa", hysaGain);
        earned.push(`$${hysaGain} in HYSA interest`);
    }
    if (vacationGain > 0) {
        adjustSavings("vacation", vacationGain);
        earned.push(`$${vacationGain} in Vacation HYSA interest`);
    }

    if (retirementBal > 0) {
        const factor = randomMarketFactor();
        const retirementRate = (RETIREMENT_BASE_APY / ROUNDS_PER_YEAR) * factor;
        retirementGain = Math.floor(retirementBal * retirementRate);
        retirementGain = Math.max(-retirementBal, retirementGain);
        if (retirementGain !== 0) {
            adjustSavings("retirement", retirementGain);
        }
        if (factor >= 1.1) {
            marketMood = "Market Rally! Portfolio up.";
        } else if (factor <= 0.2) {
            marketMood = "Market Dip. Portfolio stagnant.";
        } else if (factor < 0.6) {
            marketMood = "Market dip. Portfolio wobbled.";
        }
        if (retirementGain !== 0) {
            const dir = retirementGain > 0 ? "+" : "-";
            earned.push(
                `Retirement ${
                    retirementGain > 0 ? "grew" : "lost"
                } ${dir}$${Math.abs(retirementGain)}`,
            );
        } else {
            earned.push("Retirement held steady this round.");
        }
    } else {
        state.lastMarketFactor = 1;
    }

    if (marketMood) {
        earned.unshift(marketMood);
    }

    if (earned.length) {
        showToast(earned.join("; "));
    }
}

// --- ROUND LOGIC ---
function startRound() {
    state.retirementMatchThisRound = 0;
    processScheduledWithdrawals();
    applySavingsInterest();

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
        addCard("fixed", "Utilities", 50, false, { roundsLeft: 2 });
    if (state.round % 4 === 1 && !hasActiveCard("Car Payment"))
        addCard("fixed", "Car Payment", 750, false, {
            note: "Monthly auto loan.",
            roundsLeft: 2,
        });
    if (state.round % 4 === 1 && !hasActiveCard("Student Loan"))
        addCard("fixed", "Student Loan", 200, false, {
            note: "Monthly student loan payment.",
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
    addCard("goal", "Emergency Fund / Savings", 100, true, {
        note: "0.01% APY; withdraw anytime.",
        meta: { savingsType: "emergency" },
    });
    addCard("goal", "High-Yield Savings Account (HYSA)", 150, true, {
        note: "3.5% APY; withdrawals arrive next round.",
        meta: { savingsType: "hysa" },
    });
    addCard("goal", "Vacation Fund", 50, true, {
        note: "HYSA-like rate; withdrawals arrive next round.",
        meta: { savingsType: "vacation" },
    });
    addCard("goal", "Retirement Contribution", 150, true, {
        note: "Employer match on cash; locked with market swings.",
        meta: { savingsType: "retirement" },
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
                    showToast(
                        "Health insurance activated. Premium will recur.",
                    );
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

        addCard("opp", "Overtime Block", 1, true, {
            note: "Drop $1 to work overtime: +$200 cash, QoL -2 (raises burnout risk).",
            onPaid: () => {
                state.cash += 200;
                adjustQoL(-2);
                state.flags.burnoutRisk += 1;
                showToast("Overtime complete: +$200 cash, QoL -2.");
            },
        });

        if (isSummer(state.round) && !state.flags.marketHabitActive) {
            addCard("opp", "Farmers' Market Habit", 30, true, {
                note: "Buy local goodies. QoL +1 each summer round while active.",
                onPaid: () => {
                    state.flags.marketHabitActive = true;
                    adjustQoL(1);
                    showToast("Market habit started.");
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
    if (state.round < EVENT_UNLOCK_ROUND) return;

    // Recovery tick from recent injuries
    if (state.flags.slipRecoveryRounds > 0) {
        adjustQoL(-1);
        state.flags.slipRecoveryRounds -= 1;
    }

    if (state.flags.marketHabitActive && isSummer(state.round)) {
        adjustQoL(1);
    }

    // Slip on the Ice (winter)
    if (isWinter(state.round) && Math.random() < 0.15) {
        if (state.coverage.health) {
            addCard("event", "Slip on the Ice (Copay)", 100, false, {
                note: "Health insurance covers most of this injury.",
                debtOnMiss: 100,
            });
            adjustQoL(-3);
        } else {
            addCard("event", "Medical Bill: Slip on the Ice", 3000, false, {
                note: "No insurance — big medical bill hits.",
                debtOnMiss: 3000,
            });
            adjustQoL(-5);
        }
        state.flags.slipRecoveryRounds = 1;
    }

    // Winter heating spike
    if (isWinter(state.round) && Math.random() < 0.1) {
        addCard("event", "Winter Heating Spike", 80, false, {
            note: "Cold snap drove utilities up this round.",
            debtOnMiss: 80,
        });
        adjustQoL(-1);
    }

    // Burnout warning based on low QoL
    if (state.qol < 35 && Math.random() < 0.15) {
        const takeBreak = confirm(
            "Burnout warning! Take a mental health break (lose half a paycheck, QoL +10) or push through?",
        );
        if (takeBreak) {
            const cost = Math.round(state.job.pay / 2);
            if (state.cash >= cost) {
                state.cash -= cost;
            } else {
                recordDebt(cost, "Mental health break on credit");
            }
            adjustQoL(10);
            state.flags.burnoutRisk = 0;
        } else {
            state.flags.burnoutRisk += 1;
            adjustQoL(-3);
            if (state.flags.burnoutRisk >= 2) {
                state.flags.layoffRoundsLeft = Math.max(
                    state.flags.layoffRoundsLeft,
                    2,
                );
                adjustQoL(-5);
                state.flags.burnoutRisk = 0;
            }
        }
    }

    // Performance review every ~6 rounds
    if (state.round - state.flags.lastPerformanceReview >= 6) {
        state.flags.lastPerformanceReview = state.round;
        if (state.qol >= 60) {
            const bump = Math.random() < 0.5 ? 0.05 : 0.1;
            state.job.pay = Math.round(state.job.pay * (1 + bump));
            adjustQoL(2);
            showToast("Great performance review! Salary up.");
        } else if (state.qol < 40) {
            adjustQoL(-3);
            state.flags.layoffRisk += 1;
            showToast("Performance review was rough. Job risk increased.");
        } else {
            showToast("Performance review neutral.");
        }
    }

    // Company layoffs (chance scales with risk)
    const layoffChance = 0.04 + 0.02 * state.flags.layoffRisk;
    if (Math.random() < layoffChance) {
        const dur = 2 + Math.floor(Math.random() * 3);
        state.flags.layoffRoundsLeft = Math.max(
            state.flags.layoffRoundsLeft,
            dur,
        );
        const buffer = liquidityTotal() >= monthlyFixedEstimate() * 3;
        adjustQoL(buffer ? -2 : -6);
        if (!buffer) {
            recordDebt(200, "Borrowed to cover bills during layoff");
        }
        showToast(`Company layoffs: no pay for ${dur} rounds.`);
        state.flags.layoffRisk = Math.max(0, state.flags.layoffRisk - 1);
    }

    // Unexpected bonus
    if (Math.random() < 0.08) {
        const bonus = state.job.pay;
        const auto = confirm(
            `Unexpected bonus! +$${bonus}. Auto-allocate 50% to debt, 30% to savings, 20% to cash?`,
        );
        if (auto) {
            const toDebt = Math.min(state.debt, Math.round(bonus * 0.5));
            const toSave = Math.round(bonus * 0.3);
            state.debt = Math.max(0, state.debt - toDebt);
            adjustSavings("emergency", toSave);
            state.cash += bonus - toDebt - toSave;
            syncDebtCardAmount();
        } else {
            state.cash += bonus;
        }
        showToast("Bonus received!");
    }

    // Rent hike once per year
    if (!state.flags.rentHiked && state.round >= 13) {
        const bump = Math.max(10, Math.round(state.home.cost * 0.07));
        state.home.cost += bump;
        state.flags.rentHiked = true;
        addCard("opp", "Negotiate Rent Hike", 75, true, {
            note: "Pay to negotiate; success trims the increase.",
            onPaid: () => {
                const reduction = Math.round(bump * 0.5);
                state.home.cost = Math.max(0, state.home.cost - reduction);
                showToast("Negotiation helped reduce rent.");
            },
        });
        showToast("Rent increased at renewal.");
    }

    // Car breakdown on the Beltline
    if (Math.random() < 0.08) {
        addCard("event", "Car Breakdown", 400, false, {
            note: "Tow + repair. Pay now or it becomes debt.",
            debtOnMiss: 400,
        });
        adjustQoL(-4);
    }
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
    const isSavings = !!card.meta?.savingsType;
    let valStr = ev.dataTransfer.getData("val");
    let type = ev.dataTransfer.getData("type");

    // Calculate current total paid and cap for variable spending
    const cap = isSavings ? Infinity : card.meta?.max ?? card.amount;
    let currentPaid = card.payments.reduce((sum, p) => sum + p.amount, 0);
    let remaining = isSavings ? Infinity : Math.max(0, cap - currentPaid);

    if (!isSavings && remaining <= 0) {
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
    const savingsType = card.meta?.savingsType || "other";
    const payment = {
        id: paymentId,
        amount: amount,
        type: type,
        savingsType,
    };
    card.payments.push(payment);

    let newPaidTotal = card.payments.reduce((sum, p) => sum + p.amount, 0);

    if (type === "credit") {
        recordDebt(amount, `Credit used on ${card.title}`, { paymentId });
    }

    if (card.type === "goal") {
        adjustSavings(savingsType, amount);
        const matchAmount = maybeApplyEmployerMatch({
            amount,
            type,
            savingsType,
        });
        if (matchAmount > 0) {
            payment.matchAmount = matchAmount;
        }
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
            state.cards = state.cards.filter(
                (c) => !(c.meta && c.meta.debtCard),
            );
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
    if (card.meta?.savingsType) {
        showToast("Drop a bill to deposit into savings.");
        return;
    }

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

    const savingsType = card.meta?.savingsType || "other";
    card.payments.push({
        id: paymentId,
        amount: remaining,
        type: paymentType,
        savingsType,
    });

    if (card.type === "goal") {
        adjustSavings(savingsType, remaining);
    }

    if (card.meta?.debtCard) {
        state.debt = Math.max(0, state.debt - remaining);
        syncDebtCardAmount();
        if (state.debt <= 0) {
            state.cards = state.cards.filter(
                (c) => !(c.meta && c.meta.debtCard),
            );
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
        adjustSavings(payment.savingsType || "other", -payment.amount);
        const clawback = payment.matchAmount || 0;
        if (clawback > 0) {
            adjustSavings("retirement", -clawback);
            state.retirementMatchThisRound = Math.max(
                0,
                state.retirementMatchThisRound - clawback,
            );
        }
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
        document.getElementById(`count-${t}`).innerText = `${
            state.cards.filter((c) => c.type === t).length
        }`;
    });

    state.cards.forEach((card) => {
        let paid = card.payments.reduce((sum, p) => sum + p.amount, 0);
        const maxTarget = card.meta?.max ?? card.amount;
        const baseTarget = card.meta?.base ?? card.amount;
        const isVariable = card.type === "var";
        const isSavings = !!card.meta?.savingsType;
        const isRetirement =
            isSavings && card.meta.savingsType === "retirement";
        const savingsBal = isSavings
            ? savingsBalance(card.meta.savingsType)
            : 0;
        let progress = isSavings ? 0 : Math.min(100, (paid / maxTarget) * 100);
        let isDone = isVariable
            ? paid >= baseTarget
            : isSavings
            ? false
            : paid >= card.amount;
        const hideDrop = isSavings
            ? false
            : isVariable
            ? paid >= maxTarget
            : isDone;
        const debtRisk =
            card.type === "fixed" ||
            card.debtOnMiss !== null ||
            card.meta?.debtCard;
        const contextAttr = card.meta?.savingsType
            ? `oncontextmenu="openCardMenu(event, ${card.id})"`
            : "";
        const cautionHtml = debtRisk
            ? `<span class="caution-icon" title="${
                  card.meta?.debtCard
                      ? "This represents your outstanding debt. Paying reduces your balance."
                      : "If you skip this, it will turn into debt with penalties."
              }">⚠️</span>`
            : "";

        let dueText = "";
        if (debtRisk) {
            const roundsLeft = card.meta?.debtCard ? 0 : card.roundsLeft ?? 1;
            if (card.meta?.debtCard) {
                dueText = "Due: pay down anytime (existing debt).";
            } else if (roundsLeft <= 1) {
                dueText = "Due this round.";
            } else {
                const weeks = roundsLeft * 2;
                dueText = `Due in ${weeks} week${weeks === 1 ? "" : "s"}.`;
            }
        }

        const notesHtml = [card.note, isSavings ? "" : dueText]
            .filter(Boolean)
            .map((txt) => `<div class="card-note">${txt}</div>`)
            .join("");

        const displayAmount = isSavings
            ? `Balance: $${savingsBal}`
            : isVariable
            ? `Up to $${maxTarget}`
            : `$${card.amount}`;
        const footerText = isSavings
            ? card.meta.savingsType === "hysa" ||
              card.meta.savingsType === "vacation"
                ? "3.5% APY; withdrawals land next round."
                : card.meta.savingsType === "retirement"
                    ? "Volatile market returns; locked until retirement. Cash gets employer match."
                    : "0.01% APY; withdraw anytime."
            : isVariable
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
            <div class="game-card ${card.type} ${
            isDone ? "paid-full" : ""
        }" ${contextAttr}>
                <div class="card-top">
                    <span class="card-title">${cautionHtml}${card.title}</span>
                    <span style="font-weight:bold">${displayAmount}</span>
                </div>
                ${notesHtml}
                
                ${
                    !hideDrop
                        ? `
                <div class="drop-zone" ondrop="drop(event, ${
                    card.id
                })" ondragover="allowDrop(event)" ondragleave="leaveDrop(event)">
                    Drop Here
                </div>
                ${
                    isSavings
                        ? ""
                        : `<button class="payfull-btn" onclick="payFull(${card.id})">
                    Pay Full
                </button>`
                }`
                        : ""
                }

                ${
                    isVariable
                        ? `<div style="font-size:0.8rem; color:#777; margin-top:6px;">
                            Base $${baseTarget} keeps QoL steady; up to $${maxTarget} gives smaller boosts.
                           </div>`
                        : isSavings
                            ? `<div style="font-size:0.8rem; color:#777; margin-top:6px;">
                            ${
                                isRetirement
                                    ? "Cash contributions only. Employer match applies; funds are locked."
                                    : "Drop cash to deposit. Right-click for withdrawals."
                            }
                           </div>`
                        : ""
                }

                <div class="payment-stack">
                    ${stackHtml}
                </div>

                ${
                    isSavings
                        ? ""
                        : `<div class="card-progress">
                    <div class="card-progress-bar" style="width: ${progress}%"></div>
                </div>`
                }
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
    const fmt = (val) => `$${Math.round(val).toLocaleString()}`;
    const cash = state.cash;
    const emerg = state.savings.emergency || 0;
    const hysa = state.savings.hysa || 0;
    const vacation = state.savings.vacation || 0;
    const liquidity = liquidityTotal();
    const nestEgg = nestEggTotal();

    document.getElementById("ui-round").innerText = state.round;
    document.getElementById("ui-liquidity").innerText =
        fmt(liquidity);
    document.getElementById("ui-cash").innerText = fmt(cash);
    document.getElementById("ui-emergency").innerText =
        fmt(emerg);
    document.getElementById("ui-hysa").innerText = fmt(hysa);
    document.getElementById("ui-vacation").innerText =
        fmt(vacation);
    document.getElementById("ui-nest-egg").innerText =
        fmt(nestEgg);
    document.getElementById("ui-debt").innerText = fmt(state.debt);
    document.getElementById(
        "ui-debt-count",
    ).innerText = `${state.debtRecords.length}`;
    document.getElementById("debt-badge").title =
        state.debtRecords.length === 0
            ? "No debt currently"
            : state.debtRecords
                  .map((d) => `${d.reason}: $${d.amount}`)
                  .join("\n");
    document.getElementById("ui-qol-text").innerText = state.qol;
    document.getElementById("ui-qol-bar").style.width = `${Math.max(
        0,
        Math.min(100, state.qol),
    )}%`;
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

function openCardMenu(ev, cardId) {
    const card = state.cards.find((c) => c.id == cardId);
    if (!card || !card.meta?.savingsType) return;

    ev.preventDefault();
    ev.stopPropagation();
    closeCardMenu();

    const options = [];
    if (card.meta.savingsType === "emergency") {
        options.push({
            label: "Withdraw money",
            action: () => openWithdrawModal("emergency", cardId),
        });
    }
    if (card.meta.savingsType === "hysa") {
        options.push({
            label: "Schedule withdrawal",
            action: () => openWithdrawModal("hysa", cardId),
        });
    }
    if (card.meta.savingsType === "vacation") {
        options.push({
            label: "Schedule withdrawal",
            action: () => openWithdrawModal("vacation", cardId),
        });
    }
    if (card.meta.savingsType === "retirement") {
        options.push({
            label: "Locked until retirement (Age 59½)",
            disabled: true,
        });
    }

    if (options.length === 0) return;
    contextMenuOptions = options;

    const menu = document.getElementById("card-menu");
    menu.innerHTML = options
        .map(
            (opt, idx) =>
                `<div class="ctx-item ${opt.disabled ? "disabled" : ""}" ${opt.disabled ? "" : `onclick="selectCardMenuOption(${idx})"`}>${opt.label}</div>`,
        )
        .join("");
    menu.style.left = `${ev.pageX}px`;
    menu.style.top = `${ev.pageY}px`;
    menu.classList.add("show");
}

function closeCardMenu() {
    const menu = document.getElementById("card-menu");
    menu.classList.remove("show");
    contextMenuOptions = [];
}

function selectCardMenuOption(idx) {
    const opt = contextMenuOptions[idx];
    if (!opt || opt.disabled) return;
    closeCardMenu();
    if (typeof opt.action === "function") opt.action();
}

document.addEventListener("click", () => closeCardMenu());

function openWithdrawModal(type, cardId) {
    closeCardMenu();
    if (type === "retirement") {
        showToast("Retirement funds are locked until retirement age (59½).");
        return;
    }
    const balance = savingsBalance(type);
    if (balance <= 0) {
        showToast("No savings available to withdraw.");
        return;
    }
    withdrawContext = { type, cardId, max: balance };
    const modal = document.getElementById("withdraw-modal");
    document.getElementById("withdraw-title").innerText =
        type === "hysa"
            ? "Schedule HYSA Withdrawal"
            : type === "vacation"
                ? "Schedule Vacation Withdrawal"
                : "Withdraw from Emergency Fund";
    document.getElementById("withdraw-desc").innerText =
        type === "hysa"
            ? `Available: $${balance}. Scheduled funds land at the start of next round.`
            : type === "vacation"
                ? `Available: $${balance}. Vacation HYSA funds land next round.`
                : `Available: $${balance}. Withdrawals arrive immediately.`;
    const input = document.getElementById("withdraw-amount");
    input.value = Math.min(
        balance,
        Math.max(0, Number(input.value) || balance),
    );
    input.max = balance;
    modal.classList.remove("hidden");
}

function closeWithdrawModal() {
    const modal = document.getElementById("withdraw-modal");
    modal.classList.add("hidden");
    withdrawContext = null;
}

function confirmWithdraw() {
    if (!withdrawContext) return;
    const input = document.getElementById("withdraw-amount");
    let amt = Math.floor(Number(input.value));
    const max = withdrawContext.max;
    if (!amt || amt <= 0) {
        showToast("Enter an amount to withdraw.");
        return;
    }
    if (amt > max) {
        showToast("Cannot withdraw more than you have.");
        return;
    }

    if (withdrawContext.type === "emergency") {
        adjustSavings("emergency", -amt);
        state.cash += amt;
        showToast(`Withdrew $${amt} to your balance.`);
    } else if (withdrawContext.type === "hysa") {
        adjustSavings("hysa", -amt);
        state.scheduledWithdrawals.push({
            amount: amt,
            source: "HYSA",
            roundDue: state.round + 2,
        });
        showToast(`Scheduled $${amt} from HYSA for next round.`);
    } else if (withdrawContext.type === "vacation") {
        adjustSavings("vacation", -amt);
        state.scheduledWithdrawals.push({
            amount: amt,
            source: "Vacation Fund",
            roundDue: state.round + 2,
        });
        showToast(`Scheduled $${amt} from Vacation Fund for next round.`);
    }

    closeWithdrawModal();
    renderAll();
}

function openRecap() {
    const modal = document.getElementById("recap-modal");
    renderLog();
    modal.classList.add("show");
}

function closeRecap() {
    const modal = document.getElementById("recap-modal");
    modal.classList.remove("show");

    // Check if we should offer victory choice (completed 52 weeks)
    if (state.flags.offeredVictory && state.round > 26 && !state.gameOver) {
        showVictoryChoice();
        return;
    }

    const shouldStartRound =
        state.pendingRoundStart && !state.gameOver;
    const shouldShowEndgame =
        state.pendingEndgame && state.gameOver;

    state.pendingRoundStart = false;

    if (shouldStartRound) {
        startRound();
    } else if (shouldShowEndgame) {
        state.pendingEndgame = false;
        showEndgameSummary();
    }
}

function showVictoryChoice() {
    const continueGame = confirm(
        "Congratulations! You've survived 52 weeks (1 full year)!\n\n" +
        "You can:\n" +
        "• Click OK to EXIT and see your victory recap\n" +
        "• Click Cancel to CONTINUE playing\n\n" +
        "What would you like to do?"
    );

    if (continueGame) {
        // Player wants to exit - they WIN!
        state.gameOver = true;
        state.pendingEndgame = true;
        showEndgameSummary(true); // Pass true to indicate victory
    } else {
        // Player wants to continue
        state.flags.offeredVictory = false; // Reset so they can be offered again later if desired
        startRound();
    }
}

function showEndgameSummary(isVictory = false) {
    const overlay = document.getElementById("endgame-overlay");
    if (!overlay) return;

    const liquidity = liquidityTotal();
    const nestEgg = nestEggTotal();
    const netWorth = netWorthTotal();
    const cash = state.cash;
    const emerg = state.savings.emergency || 0;
    const hysa = state.savings.hysa || 0;
    const vacation = state.savings.vacation || 0;
    const fmt = (val) => `$${Math.round(val).toLocaleString()}`;

    document.getElementById("endgame-networth").innerText =
        fmt(netWorth);
    document.getElementById("endgame-liquidity").innerText =
        fmt(liquidity);
    document.getElementById("endgame-nest").innerText =
        fmt(nestEgg);
    document.getElementById("endgame-debt").innerText =
        fmt(state.debt);
    document.getElementById("endgame-breakdown").innerText =
        `Cash $${cash.toLocaleString()} · Emerg $${emerg.toLocaleString()} · HYSA $${hysa.toLocaleString()} · Vacation $${vacation.toLocaleString()}`;
    document.getElementById("endgame-future").innerText =
        retirementFutureStatus(nestEgg);
    const reasonEl = document.getElementById("endgame-reason");
    if (reasonEl) {
        reasonEl.innerText = isVictory
            ? "🎉 VICTORY! You made it through a full year! Here's your final snapshot."
            : "Year complete! Here's your net worth snapshot.";
    }

    overlay.classList.remove("hidden");
}

function buildRoundLog(unpaidFixed, extraLogs = []) {
    const log = [];
    let totalCredit = 0;

    state.cards.forEach((card) => {
        if (card.meta?.savingsType) return;
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
                    `Because you underfunded ${rules.title.toLowerCase()} for ${
                        tracker.missedRounds
                    } round(s), QoL fell by ${penalty}.`,
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
    if (state.gameOver) return;
    const debtCards = state.cards.filter((c) => {
        const paid = c.payments.reduce((s, p) => s + p.amount, 0);
        return (
            paid < c.amount &&
            c.type !== "goal" &&
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
            const debtAdd =
                c.debtOnMiss !== null ? c.debtOnMiss : baseOwed + 50;
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

    const transferred = transferGoalBalancesToSavings();
    const transferLogs = [];

    if (transferred.length > 0) {
        const msg = transferred
            .map((t) => {
                if (t.type === "vacation") {
                    transferLogs.push(
                        `Because you set aside money for your vacation fund, $${t.amount} stays in your HYSA-style trip fund earning interest and can be scheduled for next round.`,
                    );
                    return `Vacation HYSA: $${t.amount}`;
                }
                transferLogs.push(
                    `Because you invested for retirement, $${t.amount} stays locked in your nest egg earning market returns.`,
                );
                return `Retirement locked: $${t.amount}`;
            })
            .join(" | ");
        showToast(`Savings update: ${msg}`);
    }

    const sweptCash = sweepCashToEmergency();
    const sweepLogs =
        sweptCash > 0
            ? [
                  `Because you swept $${sweptCash} of leftover balance into your emergency fund, it will start earning interest instead of sitting idle.`,
              ]
            : [];
    if (sweptCash > 0) {
        showToast(`Leftover cash moved to Emergency Fund: $${sweptCash}`);
    }

    const finishingRound = state.round;
    const roundLog = buildRoundLog(
        debtCards.filter((c) => c.type === "fixed"),
        variableOutcome.effects.concat(transferLogs, sweepLogs),
    );
    state.lastLog = roundLog;
    state.lastLogRound = finishingRound;
    state.homeLogThisRound = null;

    const upcomingRound = state.round + 2;
    const finishedYear = upcomingRound > 26;

    // Show recap modal automatically at the end of the round.
    renderAll();
    state.round = upcomingRound;

    // After completing 52 weeks (26 rounds), offer choice to continue or exit
    if (finishedYear && !state.flags.offeredVictory) {
        state.flags.offeredVictory = true;
        state.pendingRoundStart = false;
        state.pendingEndgame = false;
        openRecap();
        // Will show victory choice after recap is closed
        return;
    }

    state.pendingRoundStart = !state.gameOver;
    state.pendingEndgame = false;
    openRecap();
}

function showToast(msg) {
    const t = document.getElementById("toast");
    t.innerText = msg;
    t.style.opacity = 1;
    setTimeout(() => (t.style.opacity = 0), 2000);
}

init();
