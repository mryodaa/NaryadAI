// Падежи для названий оборудования и участков в текстах двойника: «фильтр Камеры-02»,
// «прошли Камеру-02», «очередь перед окраской». Склоняем первое слово (или прилагательное
// с существительным); всё, что не распознали (латиница, аббревиатуры), оставляем как есть.

export type RuCase = 'gen' | 'dat' | 'acc' | 'ins' | 'prep';

const VOWELS = 'аеёиоуыэюя';
const HUSH = 'жчшщц';
const GKH = 'гкх';

function matchCase(word: string, target: string): string {
  if (!word) return target;
  return word[0] === word[0]!.toUpperCase() ? target[0]!.toUpperCase() + target.slice(1) : target;
}

/** Существительное: женский род на -а/-я/-ия, мужской на согласный, женский на -ь (после прилагательного ж. р.) */
function noun(word: string, c: RuCase, feminineSoft = false): string | null {
  const w = word.toLowerCase();
  const last = w[w.length - 1]!;
  const prev = w[w.length - 2] ?? '';
  let out: string | null = null;
  if (w.endsWith('ия')) {
    const stem = w.slice(0, -2);
    out = stem + { gen: 'ии', dat: 'ии', acc: 'ию', ins: 'ией', prep: 'ии' }[c];
  } else if (last === 'а') {
    const stem = w.slice(0, -1);
    const gen = GKH.includes(prev) || HUSH.includes(prev) ? 'и' : 'ы';
    out = stem + { gen, dat: 'е', acc: 'у', ins: HUSH.includes(prev) ? 'ей' : 'ой', prep: 'е' }[c];
  } else if (last === 'я') {
    const stem = w.slice(0, -1);
    out = stem + { gen: 'и', dat: 'е', acc: 'ю', ins: 'ей', prep: 'е' }[c];
  } else if (last === 'ь') {
    if (!feminineSoft) return null;
    const stem = w.slice(0, -1);
    out = stem + { gen: 'и', dat: 'и', acc: 'ь', ins: 'ью', prep: 'и' }[c];
  } else if (last === 'й' || VOWELS.includes(last)) {
    return null;
  } else if (/[а-я]/.test(last)) {
    out = w + { gen: 'а', dat: 'у', acc: '', ins: HUSH.includes(last) ? 'ем' : 'ом', prep: 'е' }[c];
  }
  return out === null ? null : matchCase(word, out);
}

/** Прилагательное мужского (-ый, -ий, -ой) или женского (-ая, -яя) рода */
function adjective(word: string, c: RuCase): { text: string; feminine: boolean } | null {
  const w = word.toLowerCase();
  const end2 = w.slice(-2);
  const stem = w.slice(0, -2);
  if (end2 === 'ый' || end2 === 'ой' || end2 === 'ий') {
    const soft = end2 === 'ий' && !GKH.includes(stem[stem.length - 1] ?? '');
    const forms = soft ? { gen: 'его', dat: 'ему', acc: end2, ins: 'им', prep: 'ем' } : { gen: 'ого', dat: 'ому', acc: end2, ins: end2 === 'ий' ? 'им' : 'ым', prep: 'ом' };
    return { text: matchCase(word, stem + forms[c]), feminine: false };
  }
  if (end2 === 'ая' || end2 === 'яя') {
    const soft = end2 === 'яя';
    const forms = soft ? { gen: 'ей', dat: 'ей', acc: 'юю', ins: 'ей', prep: 'ей' } : { gen: 'ой', dat: 'ой', acc: 'ую', ins: 'ой', prep: 'ой' };
    return { text: matchCase(word, stem + forms[c]), feminine: true };
  }
  return null;
}

/** «Камера-02» → «Камеры-02» (gen); «Сушильная печь» → «Сушильной печи»; «ОТК» → «ОТК» */
export function inflect(name: string, c: RuCase): string {
  const m = /^([А-Яа-яЁё]+)(.*)$/.exec(name);
  if (!m) return name;
  const [, first, rest] = m as unknown as [string, string, string];
  if (first.length > 1 && first === first.toUpperCase()) return name;
  const adj = adjective(first, c);
  if (adj) {
    const m2 = /^(\s+)([А-Яа-яЁё]+)(.*)$/.exec(rest);
    if (!m2) return adj.text + rest;
    const [, space, second, tail] = m2 as unknown as [string, string, string, string];
    const n = noun(second, c, adj.feminine);
    return n === null ? name : `${adj.text}${space}${n}${tail}`;
  }
  const n = noun(first, c);
  return n === null ? name : n + rest;
}

/** То же с маленькой буквы — для середины фразы: «очередь перед окраской» */
export function inflectLower(name: string, c: RuCase): string {
  const s = inflect(name, c);
  return s.length > 1 && s[1] === s[1]!.toUpperCase() && /[A-ZА-ЯЁ]/.test(s[1]!) ? s : s[0]!.toLowerCase() + s.slice(1);
}

/** Склонение по числу: plural(5, ['машина', 'машины', 'машин']) */
export function pluralRu(n: number, forms: readonly [string, string, string]): string {
  const a = Math.abs(Math.round(n)) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
