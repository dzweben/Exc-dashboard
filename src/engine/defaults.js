// Starter workout types (splits) and exercises. Aliases must be specific to their
// entry: parse.js matches them on word boundaries, longest first.

const T0 = '2026-10-05T00:00:00.000Z';

const type = (id, name, kind, color, glyph, aliases, order) => ({ id, name, kind, color, glyph, aliases, order, archived: false, created: T0 });

export const DEFAULT_TYPES = [
  type('push', 'Push', 'lift', '#ff5fa2', 'PU', ['push', 'push day', 'chest day'], 10),
  type('pull', 'Pull', 'lift', '#6fc3ff', 'PL', ['pull', 'pull day', 'back day'], 20),
  type('legs', 'Legs', 'lift', '#c6f432', 'LG', ['legs', 'leg day', 'lower body'], 30),
  type('upper', 'Upper', 'lift', '#ff9f43', 'UP', ['upper', 'upper body', 'upper day'], 40),
  type('full', 'Full body', 'lift', '#b48cff', 'FB', ['full body', 'total body', 'full'], 50),
  type('arms', 'Arms', 'lift', '#ffd23f', 'AR', ['arms', 'arm day'], 60),
  type('cardio', 'Cardio', 'cardio', '#3ff0c8', 'CA', ['cardio', 'run', 'ran', 'jog', 'bike', 'cycle', 'swim', 'row', 'hike', 'walk'], 70),
  type('class', 'Class', 'other', '#ff7b7b', 'CL', ['class', 'yoga', 'pilates', 'spin', 'barre', 'hiit', 'crossfit', 'boxing'], 80),
  type('sport', 'Sport', 'other', '#9fe870', 'SP', ['basketball', 'soccer', 'tennis', 'pickleball', 'climbing', 'bouldering', 'volleyball', 'frisbee', 'golf', 'squash'], 90),
  type('mobility', 'Mobility', 'other', '#a3b8cc', 'MO', ['mobility', 'stretch', 'stretching', 'foam roll'], 100),
  type('other', 'Workout', 'other', '#b0b8c1', 'WO', ['workout', 'gym', 'lift', 'lifted', 'trained', 'exercise'], 999),
];

const ex = (id, name, kind, type, aliases) => ({ id, name, kind, type, aliases, notes: '', archived: false, created: T0 });

export const DEFAULT_EXERCISES = [
  // push
  ex('bench', 'Bench press', 'lift', 'push', ['bench', 'bench press', 'bp', 'flat bench']),
  ex('incline-bench', 'Incline bench', 'lift', 'push', ['incline bench', 'incline press', 'incline']),
  ex('db-bench', 'DB bench press', 'lift', 'push', ['db bench', 'dumbbell bench', 'db press', 'dumbbell press']),
  ex('incline-db', 'Incline DB press', 'lift', 'push', ['incline db', 'incline dumbbell', 'incline db press']),
  ex('ohp', 'Overhead press', 'lift', 'push', ['ohp', 'overhead press', 'military press', 'shoulder press', 'press']),
  ex('db-shoulder', 'DB shoulder press', 'lift', 'push', ['db shoulder press', 'dumbbell shoulder press', 'seated db press']),
  ex('lateral-raise', 'Lateral raise', 'lift', 'push', ['lateral raise', 'lateral raises', 'lat raise', 'lat raises', 'side raises', 'laterals']),
  ex('fly', 'Chest fly', 'lift', 'push', ['fly', 'flys', 'flies', 'chest fly', 'pec deck', 'cable fly']),
  ex('dips', 'Dips', 'bw', 'push', ['dip', 'dips']),
  ex('pushup', 'Push-ups', 'bw', 'push', ['pushup', 'pushups', 'push-up', 'push-ups', 'push up', 'push ups']),
  ex('triceps', 'Triceps pushdown', 'lift', 'push', ['tricep', 'triceps', 'pushdown', 'pushdowns', 'tricep pushdown', 'tricep extension', 'skull crushers', 'skullcrushers']),
  // pull
  ex('deadlift', 'Deadlift', 'lift', 'pull', ['deadlift', 'deadlifts', 'dl', 'deads']),
  ex('row', 'Barbell row', 'lift', 'pull', ['row', 'rows', 'barbell row', 'bb row', 'bent over row']),
  ex('db-row', 'DB row', 'lift', 'pull', ['db row', 'dumbbell row', 'one arm row']),
  ex('cable-row', 'Cable row', 'lift', 'pull', ['cable row', 'seated row', 'seated cable row']),
  ex('pullup', 'Pull-ups', 'bw', 'pull', ['pullup', 'pullups', 'pull-up', 'pull-ups', 'pull up', 'pull ups', 'chinup', 'chinups', 'chin-ups', 'chin ups']),
  ex('lat-pulldown', 'Lat pulldown', 'lift', 'pull', ['lat pulldown', 'pulldown', 'pulldowns', 'lat pull down', 'lat pulldowns']),
  ex('face-pull', 'Face pull', 'lift', 'pull', ['face pull', 'face pulls']),
  ex('curl', 'Biceps curl', 'lift', 'pull', ['curl', 'curls', 'bicep curl', 'bicep curls', 'biceps curl', 'db curl', 'hammer curl', 'hammer curls']),
  ex('shrug', 'Shrugs', 'lift', 'pull', ['shrug', 'shrugs']),
  // legs
  ex('squat', 'Back squat', 'lift', 'legs', ['squat', 'squats', 'back squat', 'back squats']),
  ex('front-squat', 'Front squat', 'lift', 'legs', ['front squat', 'front squats']),
  ex('rdl', 'Romanian deadlift', 'lift', 'legs', ['rdl', 'rdls', 'romanian deadlift', 'romanian deadlifts', 'stiff leg deadlift']),
  ex('leg-press', 'Leg press', 'lift', 'legs', ['leg press']),
  ex('lunge', 'Lunges', 'lift', 'legs', ['lunge', 'lunges', 'walking lunges', 'split squat', 'split squats', 'bulgarian split squat', 'bulgarians']),
  ex('leg-curl', 'Leg curl', 'lift', 'legs', ['leg curl', 'leg curls', 'hamstring curl', 'hamstring curls']),
  ex('leg-ext', 'Leg extension', 'lift', 'legs', ['leg extension', 'leg extensions', 'leg ext']),
  ex('calf-raise', 'Calf raise', 'lift', 'legs', ['calf raise', 'calf raises', 'calves']),
  ex('hip-thrust', 'Hip thrust', 'lift', 'legs', ['hip thrust', 'hip thrusts', 'glute bridge', 'glute bridges']),
  // core
  ex('plank', 'Plank', 'time', null, ['plank', 'planks']),
  ex('abs', 'Abs', 'bw', null, ['abs', 'crunches', 'situps', 'sit-ups', 'sit ups', 'leg raises', 'hanging leg raises', 'ab wheel', 'core']),
  // cardio
  ex('run', 'Run', 'cardio', 'cardio', ['run', 'ran', 'running', 'jog', 'jogged', 'jogging', 'treadmill']),
  ex('walk', 'Walk', 'cardio', 'cardio', ['walk', 'walked', 'walking', 'incline walk']),
  ex('bike', 'Bike', 'cardio', 'cardio', ['bike', 'biked', 'biking', 'cycle', 'cycled', 'cycling', 'peloton', 'stationary bike']),
  ex('row-erg', 'Rower', 'cardio', 'cardio', ['rower', 'erg', 'rowing machine', 'rowed']),
  ex('swim', 'Swim', 'cardio', 'cardio', ['swim', 'swam', 'swimming', 'laps']),
  ex('stairs', 'Stair climber', 'cardio', 'cardio', ['stairmaster', 'stair master', 'stair climber', 'stairs']),
  ex('elliptical', 'Elliptical', 'cardio', 'cardio', ['elliptical']),
  ex('hike', 'Hike', 'cardio', 'cardio', ['hike', 'hiked', 'hiking']),
];
