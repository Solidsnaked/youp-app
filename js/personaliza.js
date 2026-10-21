// YouUp — lógica de la experiencia personalizada (sin DOM ni localStorage).
// Se carga en el navegador antes del script principal (window.YouUpP) y en
// Node para las pruebas (tests/personaliza.test.js).
(function(root){
  var P = {};

  // ---------- dosis: "3 series × 8–12 reps" / "3–5 intentos × 10–20 s" ----------
  P.parseDosage = function(dosage){
    var txt = String(dosage || "");
    var m = /^\s*(\d+)(?:\s*[–-]\s*\d+)?\s*(?:series|intentos)\s*×\s*(.+)$/i.exec(txt);
    var sets = m ? parseInt(m[1], 10) : 3;
    var rest = m ? m[2] : txt;
    var r = /(\d+)(?:\s*[–-]\s*(\d+))?\s*(s\b|seg)?/i.exec(rest);
    var min = r ? parseInt(r[1], 10) : 8;
    var max = r && r[2] ? parseInt(r[2], 10) : min;
    return { sets: sets, min: min, max: max, unit: r && r[3] ? "s" : "reps" };
  };

  // ---------- meta de la próxima vez, por ejercicio ----------
  // Cumplió (todas las series ≥ meta) → +1 rep / +5 s. No cumplió → lo que hizo
  // (promedio hacia abajo). Nunca menos de 1 rep / 5 s. Tras 3 sesiones
  // seguidas sin cumplir, sugiere el paso anterior; si la meta pasa el máximo
  // de la dosis, sugiere avanzar al siguiente.
  P.nextTarget = function(prev, setsDone, dosage){
    var d = P.parseDosage(dosage);
    var floor = d.unit === "s" ? 5 : 1;
    if (!prev) return { target: Math.max(floor, d.min), misses: 0, advance: false, regress: false };
    var done = (setsDone || []).filter(function(n){ return typeof n === "number" && isFinite(n); });
    var met = done.length > 0 && done.every(function(n){ return n >= prev.target; });
    var target, misses;
    if (met){
      target = prev.target + (d.unit === "s" ? 5 : 1);
      misses = 0;
    } else {
      var sum = done.reduce(function(a, b){ return a + b; }, 0);
      target = done.length ? Math.floor(sum / done.length) : prev.target;
      misses = (prev.misses || 0) + 1;
    }
    target = Math.max(floor, target);
    return { target: target, misses: misses, advance: target > d.max, regress: misses >= 3 };
  };

  // ---------- descansos ----------
  P.SKILL_IDS = ["muscle-up","front-lever","front-lever-pierna","front-lever-tuck","planche","planche-tuck",
                 "handstand","handstand-pared","flexion-pino","l-sit"];
  P.restSecondsFor = function(exId, isBetweenExercises){
    if (P.SKILL_IDS.indexOf(exId) !== -1) return 150;
    return isBetweenExercises ? 90 : 75;
  };

  // ---------- grupos y días ----------
  P.LEVELS = ["principiante","intermedio","avanzado","experto"];
  P.GROUPS = ["traccion","empuje","piernas","core"];
  var GROUP_NAMES = { traccion:"espalda (tracción)", empuje:"empuje", piernas:"pierna", core:"core" };
  P.groupName = function(g){ return GROUP_NAMES[g] || g; };

  function isoToDay(iso){ var p = String(iso).split("-"); return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000; }
  function dayToIso(n){ var d = new Date(n * 86400000); return d.toISOString().slice(0, 10); }
  function exIndex(exercises){ var m = {}; (exercises || []).forEach(function(e){ m[e.id] = e; }); return m; }
  function groupsOfEntry(entry, idx){
    var out = {};
    ((entry && entry.ex) || []).forEach(function(id){ if (idx[id]) out[idx[id].group] = true; });
    ((entry && entry.groups) || []).forEach(function(g){ if (P.GROUPS.indexOf(g) !== -1) out[g] = true; });
    return out;
  }

  // Días desde la última vez que se entrenó cada grupo (null = nunca).
  P.daysSinceGroups = function(calendar, exercises, todayISO){
    var idx = exIndex(exercises), today = isoToDay(todayISO), res = {};
    P.GROUPS.forEach(function(g){ res[g] = null; });
    Object.keys(calendar || {}).forEach(function(date){
      var diff = today - isoToDay(date);
      if (!(diff >= 0)) return;
      var gs = groupsOfEntry(calendar[date], idx);
      Object.keys(gs).forEach(function(g){ if (res[g] === null || diff < res[g]) res[g] = diff; });
    });
    return res;
  };

  function hasTraining(entry){ return !!entry && (((entry.ex || []).length) > 0 || ((entry.groups || []).length) > 0); }

  // Días seguidos con registro, terminando hoy o ayer.
  P.trainedStreak = function(calendar, todayISO){
    var d = isoToDay(todayISO), n = 0;
    if (!hasTraining((calendar || {})[todayISO])) d -= 1;
    while (hasTraining((calendar || {})[dayToIso(d)])){ n++; d--; }
    return n;
  };

  // Días con registro en la semana actual (lunes a hoy).
  P.trainedThisWeek = function(calendar, todayISO){
    var t = isoToDay(todayISO), dow = (new Date(t * 86400000).getUTCDay() + 6) % 7, n = 0;
    for (var d = t - dow; d <= t; d++) if (hasTraining((calendar || {})[dayToIso(d)])) n++;
    return n;
  };

  // ---------- sugerencia del día ----------
  P.suggestGroup = function(days, opts){
    opts = opts || {};
    if (opts.daysPerWeek && opts.trainedThisWeek >= opts.daysPerWeek)
      return { group: null, mode: "descanso", reason: "Ya cumpliste tus días de esta semana: descansa." };
    if ((opts.streak || 0) >= 3)
      return { group: "core", mode: "suave", reason: "Llevas " + opts.streak + " días seguidos: hoy algo suave." };
    var best = null, bestDays = -1, tied = [];
    P.GROUPS.forEach(function(g){
      var d = days[g], need = g === "core" ? 1 : 2;
      var v = d === null || d === undefined ? Infinity : d;
      if (v < need) return;
      if (v > bestDays){ bestDays = v; best = g; tied = [g]; }
      else if (v === bestDays) tied.push(g);
    });
    if (!best) return { group: "core", mode: "suave", reason: "Tus músculos aún se recuperan: hoy algo suave." };
    if (tied.length > 1 && opts.goalGroup && tied.indexOf(opts.goalGroup) !== -1) best = opts.goalGroup;
    var reason;
    if (bestDays === Infinity) reason = "Todavía no has entrenado " + P.groupName(best) + ": buen momento para empezar.";
    else {
      var last = null, lastDays = Infinity;
      P.GROUPS.forEach(function(g){ var d = days[g]; if (g !== best && d !== null && d !== undefined && d < lastDays){ lastDays = d; last = g; } });
      reason = "Tu " + P.groupName(best) + " descansó " + bestDays + " días" +
        (last !== null ? (lastDays === 0 ? "; hoy ya hiciste " : lastDays === 1 ? "; ayer hiciste " : "; hace " + lastDays + " días hiciste ") + P.groupName(last) : "") + ".";
    }
    return { group: best, mode: "normal", reason: reason };
  };

  // ---------- rutinas por nivel ----------
  P.pickFromLadder = function(ladder, levelId, known, skip, exercises){
    if (!ladder) return null;
    var idx = exIndex(exercises), lvl = P.LEVELS.indexOf(levelId || "principiante"), last = null;
    skip = skip || []; known = known || {};
    // Si ya sabe hacer un paso, los anteriores también cuentan como sabidos.
    var lastKnown = -1;
    ladder.chain.forEach(function(id, i){ if (known[id]) lastKnown = i; });
    for (var i = 0; i < ladder.chain.length; i++){
      if (i < lastKnown && skip.indexOf(ladder.chain[i]) === -1){
        var pe = idx[ladder.chain[i]];
        if (pe && P.LEVELS.indexOf(pe.level) <= lvl) last = ladder.chain[i];
        continue;
      }
      var id = ladder.chain[i], e = idx[id];
      if (!e || P.LEVELS.indexOf(e.level) > lvl || skip.indexOf(id) !== -1) continue;
      if (!known[id]) return id;
      last = id;
    }
    return last;
  };

  P.GROUP_SLOTS = {
    traccion: ["Tracción","Core","Tracción","Core","Tracción"],
    empuje:   ["Empuje horizontal","Fondos (tríceps)","Empuje vertical","Empuje horizontal","Fondos (tríceps)"],
    piernas:  ["Piernas","Piernas","Core","Piernas","Core"],
    core:     ["Core","Core","Core","Core","Core"]
  };

  P.PAIN_LOAD = {
    muneca: ["flexion-inclinada","flexion-rodillas","flexion-estandar","flexion-declinada","flexion-diamante","planche","planche-tuck","cuervo",
             "pike-pushup","pike-banco","handstand","handstand-pared","flexion-pino","fondos-banco","fondos-banco-rodillas"],
    hombro: ["fondos-paralelas","flexion-declinada","flexion-pino","muscle-up","planche","planche-tuck","handstand","handstand-pared","pike-pushup","pike-banco"],
    rodilla: ["pistol-squat","pistol-asistido","zancadas","sentadilla-bulgara","sentadilla","sentadilla-sumo"]
  };
  function painBlocked(pains){
    var out = [];
    (pains || []).forEach(function(p){ (P.PAIN_LOAD[p] || []).forEach(function(id){ out.push(id); }); });
    return out;
  }

  P.buildRoutine = function(slots, ctx){
    var ids = [], blocked = painBlocked(ctx.pains), idx = exIndex(ctx.exercises);
    var ladders = {}; (ctx.ladders || []).forEach(function(l){ ladders[l.label] = l; });
    if (ctx.goalStepId && idx[ctx.goalStepId] && blocked.indexOf(ctx.goalStepId) === -1){
      var firstLadder = ladders[slots[0]];
      var goalLadderGroup = idx[ctx.goalStepId].group;
      var slotGroup = firstLadder && firstLadder.chain.length && idx[firstLadder.chain[0]] ? idx[firstLadder.chain[0]].group : null;
      var inSlots = slots.some(function(s){ var l = ladders[s]; return l && l.chain.indexOf(ctx.goalStepId) !== -1; });
      if (inSlots || slotGroup === goalLadderGroup) ids.push(ctx.goalStepId);
    }
    for (var i = 0; i < slots.length && ids.length < ctx.count; i++){
      var id = P.pickFromLadder(ladders[slots[i]], ctx.levelId, ctx.known, ids.concat(blocked), ctx.exercises);
      if (id) ids.push(id);
    }
    // Si las molestias (o el nivel) dejaron la rutina corta, se completa con core.
    while (ids.length < ctx.count){
      var extra = P.pickFromLadder(ladders["Core"], ctx.levelId, ctx.known, ids.concat(blocked), ctx.exercises);
      if (!extra) break;
      ids.push(extra);
    }
    return ids.slice(0, ctx.count);
  };

  // Rutina por músculo: en cada escalera toma el paso que le toca a la persona
  // (según su nivel y lo que ya sabe) y se queda con los que trabajan alguno de
  // esos músculos; primero los que lo tienen como músculo principal. Si faltan,
  // da otra vuelta con el paso siguiente de cada escalera.
  P.buildMuscleRoutine = function(muscles, ctx){
    var idx = exIndex(ctx.exercises), blocked = painBlocked(ctx.pains), ids = [], skip = [];
    function rank(id){
      var am = (idx[id] && idx[id].activeMuscles) || [];
      for (var i = 0; i < am.length; i++) if (muscles.indexOf(am[i]) !== -1) return i;
      return -1;
    }
    for (var round = 0; round < 3 && ids.length < ctx.count; round++){
      var picks = [];
      (ctx.ladders || []).forEach(function(l){
        var id = P.pickFromLadder(l, ctx.levelId, ctx.known, ids.concat(skip, blocked), ctx.exercises);
        if (!id) return;
        skip.push(id);
        if (rank(id) !== -1) picks.push(id);
      });
      picks.sort(function(a, b){ return rank(a) - rank(b); });
      picks.forEach(function(id){ if (ids.length < ctx.count && ids.indexOf(id) === -1) ids.push(id); });
    }
    return ids;
  };

  // ---------- prueba de nivel contra reloj ----------
  // Minutos para rango 1 (el mejor), 2 y 3; más allá del último no se pasa.
  // Oro y Platino tienen más tiempo porque sus ejercicios piden más descanso.
  P.TEST_LIMITS = { principiante:[8,11,15], intermedio:[8,11,15], avanzado:[12,16,20], experto:[12,16,20] };
  P.testRank = function(levelId, secs){
    var lim = P.TEST_LIMITS[levelId] || P.TEST_LIMITS.principiante;
    for (var i = 0; i < lim.length; i++) if (secs <= lim[i] * 60) return i + 1;
    return 0;
  };
  // Guarda la mejor marca de cada nivel (menos tiempo = mejor rango).
  P.recordTest = function(tests, levelId, secs, dateISO){
    var rank = P.testRank(levelId, secs), prev = (tests || {})[levelId], out = Object.assign({}, tests || {});
    if (rank && (!prev || secs < prev.secs)) out[levelId] = { secs: secs, rank: rank, date: dateISO };
    return { tests: out, rank: rank, improved: !!(rank && (!prev || secs < prev.secs)) };
  };

  P.countForMinutes = function(min){ return min >= 45 ? 5 : min >= 30 ? 4 : 3; };

  if (typeof module !== "undefined" && module.exports) module.exports = P;
  else root.YouUpP = P;
})(this);
