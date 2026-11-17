import type { NotAnEvent } from "@/src/domain/listing-screen";
import { matchStyles, STYLES } from "@/config/styles";

function has(title: string, needles: string[]): boolean {
  const lowerTitle = title.toLowerCase();
  return needles.some((needle) => lowerTitle.includes(needle.toLowerCase()));
}

function danceWord(title: string): boolean {
  const danceWords = [
    "ダンス",
    "踊り",
    "踊ろう",
    "盆踊り",
    "舞踏会",
    "ミロンガ",
    "プラクティカ",
    "ソーシャル",
    "dj",
  ];
  return has(title, danceWords);
}

function namesStyle(title: string): boolean {
  const named = matchStyles(title);
  return named.styles.length > 0 || named.families.length > 0;
}

function namesNonClubStyle(title: string): boolean {
  const named = matchStyles(title);
  if (named.styles.length === 0 && named.families.length === 0) {
    return false;
  }
  const clubStyleKeys = new Set<string>();
  for (const style of STYLES) {
    if (style.family === "club") {
      clubStyleKeys.add(style.key);
    }
  }
  for (const styleKey of named.styles) {
    if (!clubStyleKeys.has(styleKey)) {
      return true;
    }
  }
  for (const familyKey of named.families) {
    if (familyKey !== "club") {
      return true;
    }
  }
  return false;
}

function joins(title: string): boolean {
  const joinWords = [
    "パーティー",
    "パーティ",
    "ソーシャル",
    "ミロンガ",
    "プラクティカ",
    "レッスン",
    "クラス",
    "練習会",
    "体験会",
    "アフターパーティー",
    "アフター",
    "アフパ",
    "party",
    "social",
    "milonga",
    "practica",
    "class",
    "lesson",
    "workshop",
    "dj",
    "踊ろう",
  ];
  return has(title, joinWords);
}

/** Whether the folded text contains a Japanese dance word. */
export function hasDanceWordJa(text: string): boolean {
  const folded = text.normalize("NFKC").toLowerCase();
  const danceWords = [
    "ダンス",
    "踊り",
    "踊ろう",
    "踊る",
    "踊れる",
    "舞踏会",
    "ミロンガ",
    "プラクティカ",
    "ソーシャルダンス",
  ];
  return danceWords.some((word) => folded.includes(word));
}

/** Whether the folded text contains a Japanese party-kind word. */
export function hasPartyKindJa(text: string): boolean {
  const folded = text.normalize("NFKC").toLowerCase();
  const partyWords = [
    "パーティー",
    "パーティ",
    "クラブナイト",
    "クラブイベント",
    "オールナイト",
    "ディスコ",
    "レイヴ",
    "レイブ",
    "ハロウィン",
  ];
  return partyWords.some((word) => folded.includes(word));
}

/** Whether the folded text contains a Japanese seated-show word (only if it contains kana). */
export function hasSeatedShowJa(text: string): boolean {
  const folded = text.normalize("NFKC").toLowerCase();
  // Must contain hiragana or katakana to be considered Japanese for seated-show detection.
  if (!/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) {
    return false;
  }
  const seatedWords = [
    "コンサート",
    "演奏会",
    "リサイタル",
    "公演",
    "上映",
    "映画",
    "講演",
    "トークショー",
    "トークイベント",
    "演劇",
    "舞台",
    "発表会",
    "落語",
    "朗読",
    "展覧会",
    "鑑賞",
    "ミュージカル",
  ];
  return seatedWords.some((word) => folded.includes(word));
}

/** A Japanese live show, one-man concert or 歌謡 bar night that names no
 * dance, style, DJ, party, club or night (D-848).
 */
export function isShowTitleJa(title: string): boolean {
  // 1. must contain kana
  if (!/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(title)) {
    return false;
  }
  const folded = title.normalize("NFKC").toLowerCase();
  // 2. show words
  const showWords = ["ワンマン", "歌謡", "ライブ"];
  const hasShowWord = showWords.some((word) => folded.includes(word));
  const hasLiveWord = /(?<![a-z])live(?![a-z])/.test(folded);
  if (!hasShowWord && !hasLiveWord) {
    return false;
  }
  // 3. keep guard
  if (namesStyle(folded)) {
    return false;
  }
  if (danceWord(folded) || hasDanceWordJa(title)) {
    return false;
  }
  if (hasPartyKindJa(title)) {
    return false;
  }
  const keepSubstrings = [
    "dj",
    "パーティ",
    "party",
    "クラブ",
    "club",
    "ナイト",
    "night",
    "nite",
    "ディスコ",
    "disco",
  ];
  if (keepSubstrings.some((sub) => folded.includes(sub))) {
    return false;
  }
  return true;
}

export function screenTitleJa(title: string): NotAnEvent | null {
  // Kana marks a Japanese title. A Han-only title is left to screenTitleHan (Chinese reads 公演, 映画 too),
  // except the closure-only check below, which needs the whole title to be cancel and filler words (D-1224).
  const hasKana = /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(title);
  if (!hasKana && !/\p{Script=Han}/u.test(title)) {
    return null;
  }
  const normalized = title.normalize("NFKC").toLowerCase();

  // Helper that works on normalized text
  const hasNorm = (needles: string[]): boolean => {
    return needles.some((needle) => normalized.includes(needle));
  };

  if (hasKana) {
    // 1. boat
    const boatNeedles = ["クルーズ", "クルージング", "屋形船", "船上パーティー", "船上パーティ"];
    // "トム・クルーズ" is a name, not a boat.
    if (hasNorm(boatNeedles) && !/・クルーズ/.test(normalized)) {
      return {
        kind: "boat_or_cruise",
        reason: "a boat party or cruise (the owner lists none, 2026-10-18)",
      };
    }

    // 2. crawl / happy hour
    const crawlNeedles = ["はしご酒", "バーホッピング", "パブクロール"];
    const happyHourNeedles = ["ハッピーアワー"];
    const hasCrawl = hasNorm(crawlNeedles);
    const hasHappyHour = hasNorm(happyHourNeedles);
    if (hasCrawl || (hasHappyHour && !danceWord(normalized) && !namesStyle(normalized))) {
      return {
        kind: "crawl_bus_or_happy_hour",
        reason: "a bar crawl, party bus or happy hour (the owner lists none, 2026-10-18)",
      };
    }

    // 3. karaoke / record fair
    const karaokeNeedles = ["カラオケ"];
    const recordFairNeedles = ["レコードフェア", "レコード市", "中古レコード"];
    const hasKaraoke = hasNorm(karaokeNeedles);
    const hasRecordFair = hasNorm(recordFairNeedles);
    if ((hasKaraoke && !namesNonClubStyle(normalized)) || hasRecordFair) {
      return {
        kind: "not_dance_scope",
        reason: "karaoke or a record fair (the owner lists none, 2026-10-18)",
      };
    }

    // 4. singles
    const singlesNeedles = ["婚活", "街コン", "合コン", "恋活", "お見合い"];
    if (hasNorm(singlesNeedles) && !namesStyle(normalized) && !danceWord(normalized)) {
      return {
        kind: "not_dance_scope",
        reason: "a singles mixer or speed dating (no dance named)",
      };
    }

    // 5. games
    const gamesNeedles = [
      "ボードゲーム",
      "ボドゲ",
      "クイズナイト",
      "クイズ大会",
      "ビンゴ大会",
      "謎解き",
      "人狼",
      "ゲームナイト",
    ];
    if (hasNorm(gamesNeedles) && !danceWord(normalized) && !namesStyle(normalized)) {
      return {
        kind: "not_dance_scope",
        reason: "a games night (the owner lists none)",
      };
    }

    // 6. kids
    const kidsAlwaysNeedles = [
      "キッズ",
      "子ども向け",
      "子供向け",
      "こども向け",
      "小学生",
      "幼児",
      "未就学",
      "ちびっこ",
    ];
    const kidsParentNeedles = ["親子"];
    if (hasNorm(kidsAlwaysNeedles)) {
      return {
        kind: "not_dance_scope",
        reason: "a children's party or class (the owner lists none, D-570)",
      };
    }
    if (hasNorm(kidsParentNeedles) && !danceWord(normalized)) {
      return {
        kind: "not_dance_scope",
        reason: "a children's party or class (the owner lists none, D-570)",
      };
    }

    // 7. haunted house
    if (hasNorm(["お化け屋敷"])) {
      return {
        kind: "not_dance_scope",
        reason: "a haunted house (the owner lists none)",
      };
    }

    // 8. sound bath / meditation
    const soundBathNeedles = [
      "サウンドバス",
      "シンギングボウル",
      "瞑想",
      "ヨガニドラ",
      "ブレスワーク",
    ];
    if (hasNorm(soundBathNeedles) && !danceWord(normalized)) {
      return {
        kind: "not_dance_scope",
        reason: "a sound bath (not a dance night)",
      };
    }

    // 9. seated shows, talks, screenings
    const showNeedles = [
      "上映会",
      "映画祭",
      "映画",
      "講演",
      "トークショー",
      "トークイベント",
      "落語",
      "漫才",
      "お笑い",
      "演劇",
      "観劇",
      "公演",
      "発表会",
      "朗読会",
      "展覧会",
      "写真展",
      "展示会",
    ];
    if (hasNorm(showNeedles) && !joins(normalized)) {
      return {
        kind: "not_dance_scope",
        reason: "a seated show, talk or screening, not a dance (D-589)",
      };
    }

    // 10. language/craft classes, watch parties, book clubs, swaps
    const classNeedles = [
      "英会話",
      "語学",
      "料理教室",
      "陶芸",
      "手芸",
      "編み物",
      "書道",
      "生け花",
      "茶道",
      "パブリックビューイング",
      "観戦",
      "読書会",
      "古着交換",
    ];
    if (hasNorm(classNeedles) && !namesStyle(normalized) && !danceWord(normalized)) {
      return {
        kind: "not_dance_scope",
        reason: "a class, watch party or club that names no dance (D-588)",
      };
    }
  }

  // 11. closure-only
  const cancelWords = [
    "中止",
    "開催中止",
    "休止",
    "延期",
    "休業",
    "臨時休業",
    "定休日",
    "貸切",
    "貸し切り",
  ];
  const fillerWords = ["お知らせ", "のお知らせ", "本日", "今週", "今月", "は", "の"];
  const namesCancel = cancelWords.some((word) => normalized.includes(word));
  if (namesCancel) {
    let remaining = normalized;
    // Remove cancel words
    for (const word of cancelWords) {
      remaining = remaining.replaceAll(word, "");
    }
    // Remove filler words
    for (const word of fillerWords) {
      remaining = remaining.replaceAll(word, "");
    }
    // Remove digits, whitespace, punctuation, date characters
    remaining = remaining.replace(/[\d\s\p{P}\p{S}年月日曜火水木金土祝【】（）()]/gu, "");
    if (remaining.trim() === "") {
      return {
        kind: "closure",
        reason: "a cancellation or closed-day notice that names no event",
      };
    }
  }

  return null;
}
