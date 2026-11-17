import type { NotAnEvent } from "@/src/domain/listing-screen";
import { matchStyles, STYLES } from "@/config/styles";

function has(title: string, needles: string[]): boolean {
  const lowerTitle = title.toLowerCase();
  return needles.some((needle) => lowerTitle.includes(needle.toLowerCase()));
}

function danceWord(title: string): boolean {
  const danceWords = ["舞", "跳舞", "舞會", "舞会", "課", "课", "班"];
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
  // Build a set of club style keys from STYLES
  const clubStyleKeys = new Set<string>();
  for (const style of STYLES) {
    if (style.family === "club") {
      clubStyleKeys.add(style.key);
    }
  }
  // Check if any matched style is NOT in club family
  for (const styleKey of named.styles) {
    if (!clubStyleKeys.has(styleKey)) {
      return true;
    }
  }
  // Also check families: if any matched family is not "club", it's a non-club dance
  for (const familyKey of named.families) {
    if (familyKey !== "club") {
      return true;
    }
  }
  return false;
}

export function screenTitleHan(title: string, mooredVenue = false): NotAnEvent | null {
  // No Han character: the English token screens handle it.
  if (!/\p{Script=Han}/u.test(title)) {
    return null;
  }

  // boat: needles 遊船, 游船, 船河, 遊艇派對, 游艇派对, 帆船, 觀光船, 观光船, 郵輪, 邮轮
  // NOT a boat when the title has 遊艇會 or 游艇会 (a yacht club names a venue): strip those two words before testing
  const boatNeedles = [
    "遊船",
    "游船",
    "船河",
    "遊艇派對",
    "游艇派对",
    "帆船",
    "觀光船",
    "观光船",
    "郵輪",
    "邮轮",
  ];
  // Remove yacht club words first
  const withoutYachtClub = title.replace(/遊艇會|游艇会/g, "");
  const hasBoatNeedle = has(withoutYachtClub, boatNeedles);
  if (hasBoatNeedle) {
    // Needles that say the boat sails or cruises: dropped even at a moored barge (D-1046).
    const cruiseNeedles = ["遊船", "游船", "船河", "帆船", "觀光船", "观光船", "郵輪", "邮轮"];
    const hasCruiseNeedle = has(withoutYachtClub, cruiseNeedles);
    if (!mooredVenue || hasCruiseNeedle) {
      return {
        kind: "boat_or_cruise",
        reason: "a boat party or cruise (the owner lists none, 2026-10-18)",
      };
    }
  }

  // crawl/bus: 酒吧巡遊, 酒吧巡游, 串吧, 派對巴士, 派对巴士
  const crawlNeedles = ["酒吧巡遊", "酒吧巡游", "串吧", "派對巴士", "派对巴士"];
  // happy hour: 歡樂時光, 欢乐时光, 快樂時光, 快乐时光 only when !danceWord && !namesStyle
  const happyHourNeedles = ["歡樂時光", "欢乐时光", "快樂時光", "快乐时光"];
  const hasCrawl = has(title, crawlNeedles);
  const hasHappyHour = has(title, happyHourNeedles);
  if (hasCrawl || (hasHappyHour && !danceWord(title) && !namesStyle(title))) {
    return {
      kind: "crawl_bus_or_happy_hour",
      reason: "a bar crawl, party bus or happy hour (the owner lists none, 2026-10-18)",
    };
  }

  // karaoke: 卡拉OK, 唱K, K歌 (any letter case) unless namesNonClubStyle
  const karaokeNeedles = ["卡拉ok", "唱k", "k歌"];
  // record fair: 唱片市集, 黑膠市集, 黑胶市集, 唱片展
  const recordFairNeedles = ["唱片市集", "黑膠市集", "黑胶市集", "唱片展"];
  const hasKaraoke = has(title, karaokeNeedles);
  const hasRecordFair = has(title, recordFairNeedles);
  if ((hasKaraoke && !namesNonClubStyle(title)) || hasRecordFair) {
    return {
      kind: "not_dance_scope",
      reason: "karaoke or a record fair (the owner lists none, 2026-10-18)",
    };
  }

  // singles: 速配, 相親, 相亲, 單身派對, 单身派对 unless namesStyle || danceWord
  const singlesNeedles = ["速配", "相親", "相亲", "單身派對", "单身派对"];
  if (has(title, singlesNeedles) && !namesStyle(title) && !danceWord(title)) {
    return {
      kind: "not_dance_scope",
      reason: "a singles mixer or speed dating (no dance named)",
    };
  }

  // games: 桌遊, 桌游, 棋盤遊戲, 棋盘游戏, 問答之夜, 问答之夜, 猜謎之夜, 猜谜之夜 unless danceWord || namesStyle
  const gamesNeedles = [
    "桌遊",
    "桌游",
    "棋盤遊戲",
    "棋盘游戏",
    "問答之夜",
    "问答之夜",
    "猜謎之夜",
    "猜谜之夜",
  ];
  if (has(title, gamesNeedles) && !danceWord(title) && !namesStyle(title)) {
    return {
      kind: "not_dance_scope",
      reason: "a games night (the owner lists none)",
    };
  }

  // kids' parties: 兒童派對, 儿童派对, 小朋友派對, 小朋友派对, 親子派對, 亲子派对 (always out)
  const kidsNeedles = ["兒童派對", "儿童派对", "小朋友派對", "小朋友派对", "親子派對", "亲子派对"];
  if (has(title, kidsNeedles)) {
    return {
      kind: "not_dance_scope",
      reason: "a children's party (the owner lists none, 2026-10-28)",
    };
  }

  // haunted house: 鬼屋
  if (has(title, ["鬼屋"])) {
    return {
      kind: "not_dance_scope",
      reason: "a haunted house (the owner lists none)",
    };
  }

  // sound bath: 頌缽, 颂钵, 聲音浴, 声音浴 unless danceWord
  const soundBathNeedles = ["頌缽", "颂钵", "聲音浴", "声音浴"];
  if (has(title, soundBathNeedles) && !danceWord(title)) {
    return {
      kind: "not_dance_scope",
      reason: "a sound bath (not a dance night)",
    };
  }

  // cancellation-only: after removing every cancel word, digits, whitespace, punctuation, and date characters
  const cancelWords = ["取消", "已取消", "延期", "改期", "暫停", "暂停", "活動", "活动"];
  // Remove all cancel words at once using a single regex to avoid interference
  const cancelRegex = new RegExp(cancelWords.join("|"), "g");
  let remaining = title.replace(cancelRegex, "");
  // Remove digits, whitespace, punctuation (\p{P}), and date characters
  // Also include common full-width punctuation that might not be matched by \p{P}
  // Use Unicode code points for full-width brackets to ensure they are matched
  remaining = remaining.replace(/[\d\s\p{P}年月日號号星期週周一二三四五六日\u3010\u3011]/gu, "");
  // If nothing remains, it's a cancellation-only title
  // A cancel word itself must be there: a bare date ("11月5日") is not a cancellation.
  const namesCancel = /取消|延期|改期|暫停|暂停/.test(title);
  if (namesCancel && remaining.trim() === "") {
    return {
      kind: "closure",
      reason: "a cancellation notice that names no event",
    };
  }

  // 4. Otherwise null
  return null;
}
