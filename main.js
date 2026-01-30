/* Coeur de Donjon — Prototype HTML5 (Complet)
   Intègre :
   - Génération hexagonale dynamique
   - Monstres auto-évolutifs (ADN, mutations, mémoire)
   - Pièges intelligents
   - Vagues de héros adaptatives
   - Ressources, prestige
   - Événements, boss
   - Arbre de recherche complet avec visualisation des dépendances (SVG)
   - Panneau de détails (modal) par nœud et lancement depuis le détail
   - Sauvegarde via localStorage
   Usage: coller ce fichier en remplacement de main.js, avec l'index.html et style.css fournis précédemment.
*/

/* CONFIG */
const CONFIG = {
  timeScale: 20, // 1 = realtime
  expansionIntervalSec: 30,
  heroWaveMinSec: 120,
  heroWaveMaxSec: 300,
  hexSize: 48,
  seed: Math.floor(Math.random()*999999),
  bossEveryFloors: 25,
};

/* UTIL */
const rand = (a,b) => a + Math.random()*(b-a);
const randint = (a,b) => Math.floor(rand(a,b+1));
const choose = (arr)=> arr[Math.floor(Math.random()*arr.length)];
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));

/* ROOM TYPES */
const ROOM_TYPES = [
  {id:'monster_den', name:'Antre', cat:'combat', base:0.30, color:'#2F855A'},
  {id:'training',   name:'Entraînement', cat:'combat', base:0.10, color:'#3182CE'},
  {id:'armory',     name:'Armurerie', cat:'combat', base:0.05, color:'#D69E2E'},
  {id:'sanctuary',  name:'Sanctuaire', cat:'combat', base:0.03, color:'#805AD5'},

  {id:'trapped_corridor', name:'Couloir Piégé', cat:'trap', base:0.15, color:'#E53E3E'},
  {id:'lab',             name:'Laboratoire', cat:'trap', base:0.07, color:'#DD6B20'},
  {id:'mechanisms',      name:'Salle Mécanismes', cat:'trap', base:0.05, color:'#975A16'},

  {id:'treasure', name:'Trésor', cat:'support', base:0.08, color:'#D69E2E'},
  {id:'library',  name:'Bibliothèque', cat:'support', base:0.06, color:'#2B6CB0'},
  {id:'nexus',    name:'Nexus', cat:'support', base:0.04, color:'#7F9CF5'},
  {id:'kitchen',  name:'Cuisine', cat:'support', base:0.03, color:'#F6AD55'},

  {id:'boss',   name:'Salle Boss', cat:'special', base:0.02, color:'#9F7AEA'},
  {id:'portal', name:'Portail', cat:'special', base:0.02, color:'#63B3ED'},
  {id:'secret', name:'Secret', cat:'special', base:0.01, color:'#ECC94B'},
  {id:'altar',  name:'Autel', cat:'special', base:0.01, color:'#F56565'},
];

/* HERO CLASSES & ARCHETYPES */
const HERO_CLASSES = [
  {id:'warrior', name:'Guerrier', weight:0.30},
  {id:'rogue',    name:'Voleur', weight:0.25},
  {id:'mage',     name:'Mage', weight:0.20},
  {id:'priest',   name:'Prêtre', weight:0.15},
  {id:'ranger',   name:'Rôdeur', weight:0.10},
];
const ARCHETYPES = ['Brute','Agile','Magique','Technique','Bête'];

/* GAME STATE */
const Game = {
  rooms: new Map(),
  roomList: [],
  map: null,
  resources: {gold:0, mana:50, essence:0, souls:0},
  floor: 1,
  wavesDefeated:0,
  logLines: [],
  researchState: { branches: { monsters:0, traps:0, architecture:0, magic:0 } },
  prestigeLevel: 0,
  difficultyHistory: [],
  nextExpansionAt: 0,
  nextWaveAt: 0,
  elapsed: 0,
  timeScale: CONFIG.timeScale,
  running: true,
  eventTimer: 0,
  bossCounter: 0,
  currentResearch: null,
};

/* AXIAL HEX COORD HELPERS */
class Hex {
  constructor(q,r){ this.q=q; this.r=r; }
  key(){ return `${this.q},${this.r}`; }
  add(b){ return new Hex(this.q+b.q,this.r+b.r); }
  neighbors(){
    const dirs = [new Hex(+1,0), new Hex(+1,-1), new Hex(0,-1), new Hex(-1,0), new Hex(-1,+1), new Hex(0,+1)];
    return dirs.map(d=>this.add(d));
  }
  toPixel(size, origin){
    const x = size * Math.sqrt(3) * (this.q + this.r/2) + origin.x;
    const y = size * 1.5 * this.r + origin.y;
    return {x,y};
  }
}

/* MONSTER CLASS */
class Monster {
  constructor(level=1, archetype=choose(ARCHETYPES), dna=null){
    this.id = 'm'+Math.floor(Math.random()*1e6);
    this.level = level;
    this.archetype = archetype;
    this.dna = dna || Monster.randomDNA();
    this.traits = [];
    this.skills = ['Attaque'];
    this.xp = 0;
    this.hp = this.maxHp();
    this.alive = true;
    this.memory = {};
    this.adaptBonus = {};
  }
  static randomDNA(){ return { Force: randint(10,60), Agilite: randint(10,60), Intelligence: randint(10,60), Resistance: randint(10,60), Chance: randint(5,40) }; }
  static createRandom(level){
    const arche = choose(ARCHETYPES);
    const m = new Monster(level, arche);
    const scale = 1 + (level-1)*0.08;
    Object.keys(m.dna).forEach(k=> m.dna[k] = Math.round(clamp(m.dna[k]*scale,1,100)));
    if(Math.random() < 0.2 * (level/10)) m.mutate();
    return m;
  }
  maxHp(){ return Math.round(10 * Math.pow(1.5,this.level-1) * (1 + this.dna.Resistance/100)); }
  attackPower(){ return Math.round(5 * Math.pow(1.4,this.level-1) * (1 + this.dna.Force/100)); }
  tick(dt,room){
    // sanctuary regen
    if(room.type.id==='sanctuary') this.hp = Math.min(this.maxHp(), this.hp + dt * 0.5);
    // passive xp influenced by research
    const xpGain = dt * (Game.researchState.branches.monsters>=3 ? 0.4 : 0.1);
    this.xp += xpGain;
    if(this.xp >= 10 * this.level){
      this.xp = 0;
      this.levelUp();
    }
  }
  levelUp(){
    this.level++;
    if(Math.random() < 0.20) this.mutate();
    Game.log(`${this.archetype} monte au niveau ${this.level}`);
    this.hp = this.maxHp();
  }
  mutate(){
    const statKeys = Object.keys(this.dna);
    const k = choose(statKeys);
    let delta = randint(-10,15);
    // directed mutation bias if researched
    if(Game.researchState.branches.monsters >= 2 && Math.random() < 0.7) delta = Math.abs(delta);
    this.dna[k] = clamp(this.dna[k] + delta, 1, 100);
    if(Math.random()<0.25){
      const traitsPool = ['Poison','Vol','Régénération','Camouflage','Feu-Froid','Impact'];
      const t = choose(traitsPool);
      if(!this.traits.includes(t)) this.traits.push(t);
    }
    Game.log(`${this.archetype} a muté (${k} ${delta>=0?'+':''}${delta})`);
  }
  onWinAgainst(hero){
    this.memory[hero.class] = (this.memory[hero.class]||0) + 1;
    this.adaptBonus[hero.class] = (this.adaptBonus[hero.class]||0) + 0.05;
    this.xp += hero.level * 2;
  }
  onDie(room){
    this.alive = false;
    const share = this.xp * 0.3;
    if(room && room.monsters){
      room.monsters.forEach(m=>{ if(m !== this && m.alive) m.xp += share/Math.max(1,room.monsters.length-1); });
    }
    if(Game.researchState.branches.magic >= 3 && Math.random()<0.1){
      setTimeout(()=>{ this.alive = true; this.hp = Math.round(this.maxHp()*0.3); Game.log("Résurrection magique: un monstre revient!"); }, 5000);
    }
  }
}

/* TRAP CLASS */
class Trap {
  constructor(type, power=1){
    this.type = type;
    this.power = power;
    this.efficiency = 1;
    this.avoidCount = 0;
  }
  static createRandom(){
    const types = ['physical','magic','psycho'];
    const t = choose(types);
    return new Trap(t, rand(0.8,1.4));
  }
  onHeroAttemptAvoid(){
    this.avoidCount++;
    if(this.avoidCount>2) this.efficiency *= 1.12;
  }
  trigger(hero){
    let base = this.power * this.efficiency * (this.type==='physical'?1.0:(this.type==='magic'?1.2:0.9));
    return Math.round(5 + base*10 + Math.random()*10);
  }
}

/* ROOM CLASS */
class Room {
  constructor(hex, type){
    this.hex = hex;
    this.key = hex.key();
    this.type = type || randomRoomType();
    this.monsters = [];
    this.traps = [];
    this.discovered = false;
    this.level = 1;
    this.createdAt = Game.elapsed;
    this.goldMultiplier = this.type.id === 'treasure' ? 1.2 : 1;
    if(this.type.cat === 'combat') this.spawnInitialMonsters();
    if(this.type.cat === 'trap') this.createTraps();
  }
  spawnInitialMonsters(){
    const count = 1 + Math.floor(Math.random()*2) + Math.floor(Game.researchState.branches.monsters*0.2);
    for(let i=0;i<count;i++) this.monsters.push(Monster.createRandom(1));
  }
  createTraps(){
    const base = 1 + Math.floor(Math.random()*3);
    const extra = Math.floor(Game.researchState.branches.traps * 0.3);
    const trapCount = base + extra;
    for(let i=0;i<trapCount;i++) this.traps.push(Trap.createRandom());
    if(Game.researchState.branches.traps >= 4 && Math.random()<0.3){
      const t = Trap.createRandom(); t.power *= 1.8; t.type = 'combo'; this.traps.push(t);
    }
  }
  tick(dt){
    this.monsters.forEach(m=>m.tick(dt,this));
    if(this.type.id==='monster_den'){
      if(!this._denTimer) this._denTimer = 0;
      let spawnInterval = 10;
      if(Game.researchState.branches.monsters>=1) spawnInterval *= 0.8;
      this._denTimer += dt;
      if(this._denTimer >= spawnInterval){
        this._denTimer = 0;
        const lvl = 1 + Math.floor(Game.researchState.branches.monsters*0.6);
        const m = Monster.createRandom(lvl);
        if(Game.researchState.branches.monsters >= 4 && Math.random()<0.12 && this.monsters.length>=2){
          const a = choose(this.monsters), b = choose(this.monsters);
          const hybridDNA = {};
          Object.keys(a.dna).forEach(k=> hybridDNA[k] = Math.round((a.dna[k]+b.dna[k])/2 + randint(-5,5)));
          const hybrid = new Monster(Math.max(a.level,b.level)+1, choose(ARCHETYPES), hybridDNA);
          this.monsters.push(hybrid);
          Game.log("Hybridation: un monstre hybride apparaît !");
        } else {
          this.monsters.push(m);
          Game.log("Un monstre apparaît dans " + this.type.name);
        }
      }
    }
    // traps auto-repair
    if(Game.researchState.branches.traps >= 3){
      this.traps.forEach(t=>{ t.efficiency = Math.min(2, t.efficiency + dt * 0.01); });
    }
    // magic resurrection chance handled in Monster.onDie
  }
}

/* HERO / WAVE */
class Hero {
  constructor(level, cls){
    this.level = level;
    this.class = cls.id;
    this.name = cls.name;
    this.hp = 20 + level * 8;
    this.atk = 5 + level * 4;
    this.alive = true;
    this.avoid = cls.id==='rogue' ? 0.35 : 0.05;
  }
}
class HeroWave {
  constructor(size, depth){
    this.heroes = [];
    for(let i=0;i<size;i++){
      const cls = weightedChoice(HERO_CLASSES);
      const level = clamp(1 + Math.floor(depth*0.5) + randint(0,Math.floor(depth/5)),1,100);
      this.heroes.push(new Hero(level, cls));
    }
  }
}
function weightedChoice(arr){
  const total = arr.reduce((s,a)=>s+(a.weight||1),0);
  let r = Math.random()*total;
  for(const a of arr){ r -= (a.weight||1); if(r<=0) return a; }
  return arr[arr.length-1];
}

/* RANDOM ROOM TYPE */
function randomRoomType(){
  let probs = ROOM_TYPES.map(t=> ({...t, prob: t.base}));
  const arch = Game.researchState.branches.architecture || 0;
  probs = probs.map(p=> ({...p, prob: p.prob * (1 + arch*0.02)}));
  const total = probs.reduce((s,p)=>s+p.prob,0);
  let r = Math.random()*total;
  for(const p of probs){ r -= p.prob; if(r<=0) return p; }
  return ROOM_TYPES[0];
}

/* MAP */
class Map {
  constructor(){
    this.rooms = new Map();
    this.center = new Hex(0,0);
    this.addRoom(this.center, ROOM_TYPES[0]);
    const neigh = this.center.neighbors();
    for(let i=0;i<6;i++) this.addRoom(neigh[i], randomRoomType());
  }
  addRoom(hex, type){
    const key = hex.key();
    if(this.rooms.has(key)) return this.rooms.get(key);
    const room = new Room(hex, type);
    this.rooms.set(key, room);
    Game.roomList.push(room);
    return room;
  }
  freeNeighbors(){
    const set = new Set();
    for(const room of this.rooms.values()){
      for(const n of room.hex.neighbors()){
        if(!this.rooms.has(n.key())) set.add(n.key());
      }
    }
    return Array.from(set).map(k=>{const [q,r]=k.split(',').map(Number);return new Hex(q,r)});
  }
  expandOne(){
    const free = this.freeNeighbors();
    if(free.length===0) return null;
    const pick = choose(free);
    const t = randomRoomType();
    const room = this.addRoom(pick, t);
    return room;
  }
}

/* DIFFICULTY */
function computeDifficulty(){
  let pm = 1;
  const monsters = Game.roomList.flatMap(r=>r.monsters.filter(m=>m.alive));
  if(monsters.length>0){
    const avgLevel = monsters.reduce((s,m)=>s+m.level,0)/monsters.length;
    pm = clamp(avgLevel,1,100);
  }
  const traps = Game.roomList.flatMap(r=>r.traps);
  let cp = traps.length>0 ? clamp(traps.reduce((s,t)=>s+t.power,0)/Math.max(1,traps.length)*20,1,100) : 1;
  const pd = Game.floor * 10;
  const rr = Game.difficultyHistory.slice(-10).reduce((s,x)=>s+x,0) / Math.max(1, Game.difficultyHistory.length);
  const D = (pm*0.4)+(cp*0.3)+(pd*0.2)+(rr*0.1);
  Game.difficultyHistory.push(D);
  if(Game.difficultyHistory.length>20) Game.difficultyHistory.shift();
  return Math.round(D);
}

/* EVENTS */
function maybeTriggerEvent(){
  if(Math.random() < 0.05){
    const events = [
      ()=>{ Game.roomList.forEach(r=>{ if(Math.random()<0.02) r.traps.push(Trap.createRandom()); }); Game.log("Invasion de rats — des monstres temporaires arrivent"); },
      ()=>{ Game.roomList.forEach(r=>{ r.traps.forEach(t=>t.efficiency*=2); }); Game.log("Poussière magique — pièges 2x efficaces"); },
      ()=>{ Game.log("Mutation de masse ! Tous les monstres mutent"); Game.roomList.forEach(r=>r.monsters.forEach(m=>m.mutate())); },
      ()=>{ Game.log("Découverte Archéologique — une nouvelle salle spéciale apparaît"); const map = Game.map.expandOne(); if(map) map.type = ROOM_TYPES.find(t=>t.id==='secret') || map.type; }
    ];
    choose(events)();
  }
}

/* WAVE RESOLVE */
function resolveWave(wave){
  Game.log(`Vague d'${wave.heroes.length} héros entre !`);
  let survivors = 0;
  wave.heroes.forEach(hero=>{
    const steps = clamp(1 + Math.floor(Game.floor*0.1) + randint(0,3),1,8);
    let heroAlive = true;
    for(let s=0;s<steps && heroAlive;s++){
      const room = choose(Game.roomList.slice(0, Math.max(6, Math.floor(Game.roomList.length*0.6))));
      // traps
      for(const t of room.traps){
        const heroAvoid = hero.avoid * (1 - (Game.researchState.branches.architecture>=2?0.12:0));
        if(Math.random() > heroAvoid){
          const dmg = t.trigger(hero);
          hero.hp -= dmg;
          Game.log(`${hero.name} subit ${dmg} dégâts (piège) dans ${room.type.name}`);
          if(hero.hp<=0){ heroAlive=false; break; }
        } else {
          t.onHeroAttemptAvoid();
        }
      }
      if(!heroAlive) break;
      // monsters combat
      for(const m of room.monsters){
        if(!m.alive) continue;
        const heroToMonster = hero.atk + randint(-2,3);
        const monsterToHero = m.attackPower() + randint(-3,3);
        const adapt = m.adaptBonus[hero.class]||0;
        const mDamage = Math.round(monsterToHero*(1+adapt));
        m.hp -= Math.max(1, heroToMonster);
        hero.hp -= Math.max(0, mDamage);
        if(m.hp <= 0){ m.onWinAgainst(hero); m.onDie(room); Game.log(`${m.archetype} vaincu par ${hero.name}`); }
        if(hero.hp <= 0){ heroAlive=false; Game.log(`${hero.name} est tombé`); break; }
        if(m.alive && heroAlive && Math.random() < 0.2) m.onWinAgainst(hero);
        if(Game.researchState.branches.magic >= 4 && Math.random() < 0.02){
          heroAlive = false;
          Game.log(`${hero.name} est contrôlé mentalement !`);
          break;
        }
      }
    }
    if(heroAlive){
      const reward = 10 * hero.level * (1 + Game.roomList.length*0.01) * (1 + Game.researchState.branches.architecture*0.02);
      Game.resources.gold += Math.round(reward);
      survivors++;
    } else {
      if(hero.level >= 61) Game.resources.souls += 1;
    }
  });
  Game.log(`${survivors} héros ont survécu à la vague.`);
  const successMetric = survivors / wave.heroes.length * 100;
  Game.difficultyHistory.push(successMetric);
  Game.wavesDefeated += (survivors===0?1:0);
}

/* PRESTIGE */
function doPrestige(){
  Game.prestigeLevel++;
  Game.resources.essence += 1;
  Game.log(`Prestige réalisé ! Niveau de prestige: ${Game.prestigeLevel}`);
  Game.map = new Map();
  Game.roomList = Array.from(Game.map.rooms.values());
  Game.resources.gold = 0; Game.resources.mana = 20; Game.resources.souls = 0;
  Game.floor = 1; Game.wavesDefeated = 0;
  // preserve 50% research levels as per spec
  Object.keys(Game.researchState.branches).forEach(b=>{
    Game.researchState.branches[b] = Math.floor(Game.researchState.branches[b] * 0.5);
  });
  saveState();
}

/* RENDER / UI SETUP */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
function resize(){
  canvas.width = innerWidth * devicePixelRatio;
  canvas.height = innerHeight * devicePixelRatio;
  canvas.style.width = innerWidth+'px';
  canvas.style.height = innerHeight+'px';
  ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
  // redraw research links if present
  requestAnimationFrame(()=> drawResearchLinks());
}
window.addEventListener('resize', resize);
function drawHex(x,y,size,fill,stroke= '#000', line=1){
  const a = Math.PI/180;
  ctx.beginPath();
  for(let i=0;i<6;i++){
    const ang = (60*i-30)*a;
    const px = x + size*Math.cos(ang);
    const py = y + size*Math.sin(ang);
    if(i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = line;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}
function render(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = '#06060a'; ctx.fillRect(0,0,canvas.width,canvas.height);
  const size = CONFIG.hexSize;
  const origin = {x: canvas.width/(2*devicePixelRatio), y: canvas.height/(2*devicePixelRatio)};
  Game.roomList.forEach(room=>{
    const p = room.hex.toPixel(size, origin);
    const col = room.type.color || '#334155';
    drawHex(p.x,p.y,size-2,col,'rgba(0,0,0,0.6)',2);
    ctx.fillStyle = '#fff'; ctx.font = '12px system-ui';
    ctx.fillText(room.type.name, p.x- size + 6, p.y- size + 12);
    const aliveCount = room.monsters.filter(m=>m.alive).length;
    if(aliveCount>0){
      ctx.fillStyle = '#ffdd57'; ctx.beginPath(); ctx.arc(p.x + size*0.55, p.y - size*0.6, 12,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = '#000'; ctx.font='12px bold system-ui'; ctx.fillText(aliveCount, p.x + size*0.55 - 6, p.y - size*0.6 + 4);
    }
  });
  const centerP = Game.map.center.toPixel(size, {x:canvas.width/(2*devicePixelRatio), y:canvas.height/(2*devicePixelRatio)});
  ctx.fillStyle = 'rgba(255,85,150,0.12)'; ctx.beginPath(); ctx.arc(centerP.x, centerP.y, 8 + 6*Math.sin(Game.elapsed*0.5),0,Math.PI*2); ctx.fill();
}

/* LOG & UI updates */
function uiUpdate(){
  document.getElementById('gold').innerText = `Or: ${Math.floor(Game.resources.gold)}`;
  document.getElementById('mana').innerText = `Mana: ${Math.floor(Game.resources.mana)}`;
  document.getElementById('essence').innerText = `Essence: ${Math.floor(Game.resources.essence)}`;
  document.getElementById('souls').innerText = `âmes: ${Math.floor(Game.resources.souls)}`;
  document.getElementById('info').innerHTML = `Salles: ${Game.roomList.length}<br>Étages: ${Game.floor}<br>Prestige: ${Game.prestigeLevel}<br>Diff: ${computeDifficulty()}`;
  const logel = document.getElementById('log');
  logel.innerHTML = Game.logLines.slice(-20).reverse().map(l=>`<div>${l}</div>`).join('');
  renderResearchUI();
}

/* LOGGING */
Game.log = function(msg){
  const time = Math.floor(Game.elapsed);
  Game.logLines.push(`[${time}s] ${msg}`);
  console.log(msg);
  saveStateDebounced();
};

/* SAVE / LOAD */
function saveState(){
  const s = {
    resources: Game.resources,
    researchState: Game.researchState,
    prestigeLevel: Game.prestigeLevel,
  };
  try { localStorage.setItem('dungeon_prototype_save_v1', JSON.stringify(s)); } catch(e){ console.warn('Save failed', e); }
}
function loadState(){
  try{
    const raw = localStorage.getItem('dungeon_prototype_save_v1');
    if(!raw) return;
    const s = JSON.parse(raw);
    if(s.resources) Game.resources = s.resources;
    if(s.researchState) Game.researchState = s.researchState;
    if(typeof s.prestigeLevel !== 'undefined') Game.prestigeLevel = s.prestigeLevel;
  }catch(e){ console.warn('Load failed', e); }
}
let saveTimeout = null;
function saveStateDebounced(){ if(saveTimeout) clearTimeout(saveTimeout); saveTimeout = setTimeout(()=>saveState(), 1000); }

/* ---------------- RESEARCH SYSTEM ---------------- */
class ResearchNode {
  constructor(branch, level, title, desc, cost, timeSec){
    this.branch = branch;
    this.level = level;
    this.id = `${branch}_${level}`;
    this.title = title;
    this.desc = desc;
    this.cost = cost; // {mana, gold, essence}
    this.timeSec = timeSec;
  }
  isUnlocked(){ return Game.researchState.branches[this.branch] >= this.level - 1; }
  isCompleted(){ return Game.researchState.branches[this.branch] >= this.level; }
  isAvailable(){ return this.isUnlocked() && !this.isCompleted() && !Game.currentResearch; }
}

const ResearchTree = (function(){
  const nodes = [];
  const branches = {
    monsters: [
      {title:'Reproduction Accélérée',desc:'+20% vitesse reproduction', cost:{mana:10, gold:0, essence:0}, time:15},
      {title:'Mutations Dirigées',desc:'Mutations majoritairement bénéfiques', cost:{mana:25, gold:50, essence:0}, time:25},
      {title:'Évolution Forcée',desc:'+xp passif aux monstres', cost:{mana:60, gold:120, essence:1}, time:40},
      {title:'Hybridation',desc:'Chance de créer hybrides', cost:{mana:120, gold:300, essence:1}, time:60},
      {title:'Ascension',desc:'Monstres légendaires apparaissent', cost:{mana:300, gold:1000, essence:3}, time:120},
    ],
    traps: [
      {title:'Complexité',desc:'+1 piège par salle', cost:{mana:15, gold:20, essence:0}, time:15},
      {title:'Camouflage',desc:'-30% détection des pièges', cost:{mana:40, gold:80, essence:0}, time:30},
      {title:'Auto-Réparation',desc:'Pièges se réparent automatiquement', cost:{mana:80, gold:200, essence:1}, time:50},
      {title:'Combinaisons Auto',desc:'Pièges combinés auto-générés', cost:{mana:160, gold:400, essence:2}, time:80},
      {title:'Pièges Vivants',desc:'Pièges deviennent monstres', cost:{mana:400, gold:1200, essence:4}, time:140},
    ],
    architecture: [
      {title:'Expansion Accélérée',desc:'+25% vitesse expansion', cost:{mana:20, gold:30, essence:0}, time:18},
      {title:'Salles Spécialisées',desc:'Nouvelles salles disponibles', cost:{mana:50, gold:90, essence:0}, time:30},
      {title:'Restructuration',desc:'Réajustement automatique', cost:{mana:100, gold:220, essence:1}, time:50},
      {title:'Dimensions',desc:'Sous-sols/étages (bonus)', cost:{mana:220, gold:500, essence:2}, time:90},
      {title:'Réalité Déformée',desc:'Modifie lois physiques (fort)', cost:{mana:600, gold:2000, essence:5}, time:180},
    ],
    magic: [
      {title:'Régénération Mana',desc:'+50% mana regen', cost:{mana:15, gold:20, essence:0}, time:15},
      {title:'Aura Débilitante',desc:'-10% stats héros', cost:{mana:50, gold:120, essence:1}, time:30},
      {title:'Résurrection Monstres',desc:'10% chance de résurrection', cost:{mana:120, gold:300, essence:2}, time:60},
      {title:'Contrôle Mental',desc:'Chance de retourner un héros', cost:{mana:260, gold:700, essence:3}, time:100},
      {title:'Domaine Divin',desc:'Contrôle majeur du donjon', cost:{mana:700, gold:2500, essence:6}, time:220},
    ]
  };
  Object.keys(branches).forEach(branch=>{
    branches[branch].forEach((n,i)=>{
      nodes.push(new ResearchNode(branch, i+1, n.title, n.desc, n.cost, n.time));
    });
  });
  return {nodes};
})();

/* Effects info used in detail modal */
const EffectsInfo = {
  monsters_1: {text:'Spawn interval ×0.80 (≈ +25% fréquence de spawn)'},
  monsters_2: {text:'Mutations biasées → +70% chance d\'amélioration lors d\'une mutation'},
  monsters_3: {text:'+xp passif augmenté (ex: ×3)'},
  monsters_4: {text:'~12% de chance de créer un hybride quand conditions remplies'},
  monsters_5: {text:'Petite chance d\'apparition de monstres légendaires'},

  traps_1: {text:'+1 piège par salle'},
  traps_2: {text:'Détection -30% (héros détectent moins les pièges)'},
  traps_3: {text:'Pièges regagnent efficacité (auto-réparation)'},
  traps_4: {text:'Chance de combiner pièges en combos puissants'},
  traps_5: {text:'Certains pièges peuvent se transformer en monstres (vivants)'},

  architecture_1: {text:'Intervalle d\'expansion ×0.75 (→ +33% vitesse)'},
  architecture_2: {text:'Nouvelles salles spécialisées disponibles'},
  architecture_3: {text:'Réajustement automatique des salles pour optimisation'},
  architecture_4: {text:'Dimensions: sous-étages et bonus de progression'},
  architecture_5: {text:'Réalité déformée: modifications majeures des règles'},

  magic_1: {text:'+50% régénération de mana'},
  magic_2: {text:'Aura: -10% stats des héros (global)'},
  magic_3: {text:'10% chance de résurrection des monstres à la mort'},
  magic_4: {text:'Contrôle mental possible: retourner un héros temporairement'},
  magic_5: {text:'Domaine Divin: contrôle majeur du donjon'},
};

/* ---------- RESEARCH UI & DEPENDENCY DRAWING ---------- */
const researchContainer = document.getElementById('research');
const researchWrap = document.getElementById('research-wrap');
const svgLinks = document.getElementById('research-links');

const modal = document.getElementById('nodeModal');
const modalTitle = document.getElementById('modalTitle');
const modalDesc = document.getElementById('modalDesc');
const modalEffects = document.getElementById('modalEffects');
const modalCost = document.getElementById('modalCost');
const modalTime = document.getElementById('modalTime');
const modalBranchLevel = document.getElementById('modalBranchLevel');
const modalStartBtn = document.getElementById('modalStartBtn');
const modalClose = document.getElementById('modalClose');
const modalCancelBtn = document.getElementById('modalCancelBtn');

function renderResearchUI(){
  if(!researchContainer) return;
  researchContainer.innerHTML = '';
  ResearchTree.nodes.forEach(node=>{
    const el = document.createElement('div');
    el.className = 'research-node';
    el.dataset.nodeId = node.id;
    if(!node.isUnlocked()) el.classList.add('locked');
    if(node.isCompleted()) el.classList.add('complete');
    if(Game.currentResearch && Game.currentResearch.node.id === node.id) el.classList.add('active');

    const title = document.createElement('h4');
    title.innerText = `${node.title}`;
    title.style.cursor = 'pointer';
    title.addEventListener('click', ()=> showNodeDetails(node));
    const desc = document.createElement('div'); desc.className='small'; desc.innerText = node.desc;
    const cost = document.createElement('div'); cost.className='small'; cost.innerText = `Coût: M ${node.cost.mana} • Or ${node.cost.gold} • Es ${node.cost.essence}`;

    el.appendChild(title);
    el.appendChild(desc);
    el.appendChild(cost);

    if(node.isCompleted()){
      const done = document.createElement('div'); done.className='small'; done.innerText='Complété'; el.appendChild(done);
    } else if(Game.currentResearch && Game.currentResearch.node.id === node.id){
      const pb = document.createElement('div'); pb.className='progressbar'; const i = document.createElement('i');
      const percent = Math.round(100*(1 - Game.currentResearch.remaining / node.timeSec)); i.style.width = percent + '%'; pb.appendChild(i); el.appendChild(pb);
      const remain = document.createElement('div'); remain.className='small'; remain.innerText = `Temps restant: ${Math.max(0,Math.round(Game.currentResearch.remaining))}s`; el.appendChild(remain);
    } else {
      const btn = document.createElement('button');
      btn.innerText = node.isAvailable() ? 'Chercher' : 'Bloqué';
      btn.disabled = !node.isAvailable() || !canAfford(node.cost);
      btn.addEventListener('click', ()=> startResearch(node));
      el.appendChild(btn);
    }

    researchContainer.appendChild(el);
  });

  requestAnimationFrame(()=> drawResearchLinks());
}

function drawResearchLinks(){
  if(!svgLinks || !researchWrap) return;
  const rect = researchWrap.getBoundingClientRect();
  svgLinks.setAttribute('width', rect.width);
  svgLinks.setAttribute('height', rect.height);
  svgLinks.innerHTML = '';
  const coords = {};
  const nodesEls = Array.from(researchContainer.children);
  nodesEls.forEach(el=>{
    const id = el.dataset.nodeId;
    const r = el.getBoundingClientRect();
    coords[id] = {
      x: (r.left + r.right)/2 - rect.left,
      y: (r.top + r.bottom)/2 - rect.top,
      done: el.classList.contains('complete'),
      active: el.classList.contains('active'),
      locked: el.classList.contains('locked'),
    };
  });
  ResearchTree.nodes.forEach(node=>{
    if(node.level <= 1) return;
    const fromId = `${node.branch}_${node.level-1}`;
    const toId = node.id;
    if(!coords[fromId] || !coords[toId]) return;
    const from = coords[fromId], to = coords[toId];
    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    const midX = (from.x + to.x)/2;
    const dx = Math.abs(from.x - to.x);
    const curve = Math.min(60, dx*0.5 + 10);
    const d = `M ${from.x} ${from.y} Q ${midX} ${Math.min(from.y,to.y)-curve} ${to.x} ${to.y}`;
    path.setAttribute('d', d);
    let stroke = 'rgba(255,255,255,0.06)';
    if(coords[fromId].done && coords[toId].done) stroke = 'rgba(47,133,90,0.55)';
    else if(coords[toId].active) stroke = 'rgba(198,77,255,0.7)';
    else if(!coords[fromId].done) stroke = 'rgba(255,255,255,0.06)';
    path.setAttribute('stroke', stroke);
    path.setAttribute('stroke-width', 3);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-linecap', 'round');
    svgLinks.appendChild(path);
  });
}

/* Modal: details and start button */
function showNodeDetails(node){
  modalTitle.innerText = node.title;
  modalDesc.innerText = node.desc;
  const eff = EffectsInfo[node.id];
  modalEffects.innerHTML = '';
  if(eff) modalEffects.innerHTML = `<strong>Effets :</strong><div style="margin-top:6px">${eff.text}</div>`;
  else modalEffects.innerText = 'Aperçu de l\'effet';
  modalCost.innerText = `Coût: Mana ${node.cost.mana} • Or ${node.cost.gold} • Essence ${node.cost.essence}`;
  modalTime.innerText = `Temps: ${node.timeSec}s (accéléré par Vitesse)`;
  modalBranchLevel.innerText = `Branche: ${node.branch} — Niveau ${node.level}`;
  modalStartBtn.disabled = !node.isAvailable() || !canAfford(node.cost);
  modalStartBtn.onclick = ()=> { startResearch(node); hideModal(); };
  modalCancelBtn.onclick = hideModal;
  modalClose.onclick = hideModal;
  modal.classList.remove('hidden');
}
function hideModal(){ modal.classList.add('hidden'); }

/* Research helpers */
function canAfford(cost){
  if(!cost) return true;
  if(Game.resources.mana < (cost.mana||0)) return false;
  if(Game.resources.gold < (cost.gold||0)) return false;
  if(Game.resources.essence < (cost.essence||0)) return false;
  return true;
}
function payCost(cost){
  Game.resources.mana -= cost.mana||0;
  Game.resources.gold -= cost.gold||0;
  Game.resources.essence -= cost.essence||0;
}
function startResearch(node){
  if(!node.isUnlocked()){ Game.log("Nœud non disponible."); return; }
  if(!canAfford(node.cost)){ Game.log("Ressources insuffisantes."); return; }
  payCost(node.cost);
  Game.currentResearch = {node, remaining: node.timeSec};
  Game.log(`Recherche commencée : ${node.title} (branche ${node.branch} niveau ${node.level})`);
  renderResearchUI();
  saveStateDebounced();
}
function completeResearch(node){
  Game.researchState.branches[node.branch] = Math.max(Game.researchState.branches[node.branch], node.level);
  Game.log(`Recherche terminée : ${node.title} (branche ${node.branch} niveau ${node.level})`);
  applyResearchEffect(node);
  Game.currentResearch = null;
  renderResearchUI();
  saveState();
}
function applyResearchEffect(node){
  const b = node.branch, lvl = node.level;
  switch(b){
    case 'monsters':
      if(lvl===1) Game.log("Réduction intervalle de reproduction (×0.8) appliquée.");
      if(lvl===2) Game.log("Mutations dirigées activées (bias positif).");
      if(lvl===3) Game.log("Évolution forcée: xp passif augmenté.");
      if(lvl===4) Game.log("Hybridation: chance d'hybrides activée.");
      if(lvl===5) Game.log("Ascension: monstres légendaires désormais possibles.");
      break;
    case 'traps':
      if(lvl===1) Game.log("Complexité: + pièges par salle.");
      if(lvl===2) Game.log("Camouflage: detection réduite.");
      if(lvl===3) Game.log("Auto-réparation des pièges activée.");
      if(lvl===4) Game.log("Combinaisons automatiques activées.");
      if(lvl===5) Game.log("Pièges vivants: certains pièges deviennent monstres.");
      break;
    case 'architecture':
      if(lvl===1){ CONFIG.expansionIntervalSec *= 0.75; Game.log("Expansion accélérée (intervalle réduit)."); }
      if(lvl===2) Game.log("Salles spécialisées maintenant plus probables.");
      if(lvl===3) Game.log("Restructuration activée (optimisation automatique).");
      if(lvl===4) Game.log("Dimensions activées (bonus d'étage).");
      if(lvl===5) Game.log("Réalité déformée activée.");
      break;
    case 'magic':
      if(lvl===1) Game.log("Mana regen augmenté de +50%.");
      if(lvl===2) Game.log("Aura débilitante activée (-10% héros).");
      if(lvl===3) Game.log("Résurrection de monstres activée.");
      if(lvl===4) Game.log("Contrôle mental activé.");
      if(lvl===5) Game.log("Domaine Divin activé.");
      break;
  }
  saveStateDebounced();
}

/* ---------- GAME INIT & LOOP ---------- */
function initGame(){
  resize();
  loadState();
  Game.map = new Map();
  Game.roomList = Array.from(Game.map.rooms.values());
  Game.nextExpansionAt = Game.elapsed + CONFIG.expansionIntervalSec;
  Game.nextWaveAt = Game.elapsed + ( (CONFIG.heroWaveMinSec + Math.random()*(CONFIG.heroWaveMaxSec-CONFIG.heroWaveMinSec)) / Game.timeScale );
  Game.roomList.forEach(r=> r.discovered = true);
  Game.log("Jeu initialisé (prototype complet).");
  renderResearchUI();
}

/* Tick loop */
let last = performance.now();
function tickLoop(now){
  const dtReal = (now - last)/1000; last = now;
  const dt = dtReal * Game.timeScale;
  if(!Game.running){ requestAnimationFrame(tickLoop); return; }
  Game.elapsed += dtReal;
  Game.roomList.forEach(r=> r.tick(dt));
  // passive mana regen influenced by magic research
  const manaBase = 1/10;
  const manaMultiplier = 1 + (Game.researchState.branches.magic>=1 ? 0.5 : 0);
  Game.resources.mana += dtReal * manaBase * manaMultiplier * 1;
  // expansion
  if(Game.elapsed * Game.timeScale >= Game.nextExpansionAt){
    const room = Game.map.expandOne();
    if(room){ Game.log(`Nouvelle salle : ${room.type.name}`); Game.roomList = Array.from(Game.map.rooms.values()); }
    const arch = Game.researchState.branches.architecture || 0;
    const baseInterval = CONFIG.expansionIntervalSec * Math.max(0.4, 1 - arch*0.12);
    Game.nextExpansionAt = Game.elapsed * Game.timeScale + baseInterval;
  }
  // events
  if(Math.random() < 0.01 * dtReal) maybeTriggerEvent();
  // wave spawn
  if(Game.elapsed >= Game.nextWaveAt){
    const diff = computeDifficulty();
    const size = clamp(1 + Math.floor(diff/20), 1, 20);
    const wave = new HeroWave(size, Game.floor);
    resolveWave(wave);
    const nextSec = (CONFIG.heroWaveMinSec + Math.random()*(CONFIG.heroWaveMaxSec-CONFIG.heroWaveMinSec))/Game.timeScale;
    Game.nextWaveAt = Game.elapsed + nextSec;
    Game.floor += 1;
    Game.bossCounter++;
    if(Game.bossCounter >= CONFIG.bossEveryFloors){
      Game.bossCounter = 0;
      const r = Game.map.expandOne();
      if(r) r.type = ROOM_TYPES.find(t=>t.id==='boss') || r.type;
      Game.log("Un boss est né dans une salle !");
    }
  }
  // research progress
  if(Game.currentResearch){
    Game.currentResearch.remaining -= dtReal * Game.timeScale;
    if(Game.currentResearch.remaining <= 0){
      completeResearch(Game.currentResearch.node);
    }
  }
  render();
  uiUpdate();
  requestAnimationFrame(tickLoop);
}

/* UI Buttons */
document.getElementById('speedBtn').addEventListener('click', ()=>{
  if(Game.timeScale===1){ Game.timeScale = 10; document.getElementById('speedBtn').innerText='Vitesse x10'; }
  else if(Game.timeScale===10){ Game.timeScale = 50; document.getElementById('speedBtn').innerText='Vitesse x50'; }
  else { Game.timeScale = 1; document.getElementById('speedBtn').innerText='Vitesse x1'; }
});
document.getElementById('prestigeBtn').addEventListener('click', ()=>{
  if(confirm('Faire un prestige ? (réinitialise le donjon, gagne Essence)')) doPrestige();
});

/* Save periodically */
setInterval(()=>saveState(), 5000);

/* Start */
initGame();
requestAnimationFrame(tickLoop);

/* Helpers: expose for debug */
window.GAME = Game;
window.ResearchTree = ResearchTree;
window.EffectsInfo = EffectsInfo;

/* Redraw links on resize */
window.addEventListener('resize', ()=> { requestAnimationFrame(()=> drawResearchLinks()); });

/* Hook modal close if present */
if(document.getElementById('modalClose')){
  document.getElementById('modalClose').onclick = ()=>{ if(modal) modal.classList.add('hidden'); };
}
if(document.getElementById('modalCancelBtn')){
  document.getElementById('modalCancelBtn').onclick = ()=>{ if(modal) modal.classList.add('hidden'); };
}
