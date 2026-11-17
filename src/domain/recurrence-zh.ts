/** Chinese (zh, Traditional and Simplified) recurrence phrases. */
import type { LangSpec, Weekday } from "@/src/domain/recurrence";

// Day names: 星期一..星期六 and 星期日/星期天; 週一..週日/週天 and 周一..周日/周天; 禮拜一..禮拜日/禮拜天 and 礼拜一..礼拜日/礼拜天
// Map 一=MO 二=TU 三=WE 四=TH 五=FR 六=SA 日/天=SU
const dayForms: Record<Weekday, string[]> = {
  MO: [
    "星期一",
    "星期1",
    "週一",
    "周一",
    "禮拜一",
    "礼拜一",
    "星期1",
    "週1",
    "周1",
    "禮拜1",
    "礼拜1",
  ],
  TU: [
    "星期二",
    "星期2",
    "週二",
    "周二",
    "禮拜二",
    "礼拜二",
    "星期2",
    "週2",
    "周2",
    "禮拜2",
    "礼拜2",
  ],
  WE: [
    "星期三",
    "星期3",
    "週三",
    "周三",
    "禮拜三",
    "礼拜三",
    "星期3",
    "週3",
    "周3",
    "禮拜3",
    "礼拜3",
  ],
  TH: [
    "星期四",
    "星期4",
    "週四",
    "周四",
    "禮拜四",
    "礼拜四",
    "星期4",
    "週4",
    "周4",
    "禮拜4",
    "礼拜4",
  ],
  FR: [
    "星期五",
    "星期5",
    "週五",
    "周五",
    "禮拜五",
    "礼拜五",
    "星期5",
    "週5",
    "周5",
    "禮拜5",
    "礼拜5",
  ],
  SA: [
    "星期六",
    "星期6",
    "週六",
    "周六",
    "禮拜六",
    "礼拜六",
    "星期6",
    "週6",
    "周6",
    "禮拜6",
    "礼拜6",
  ],
  SU: [
    "星期日",
    "星期天",
    "週日",
    "周日",
    "禮拜日",
    "礼拜日",
    "禮拜天",
    "礼拜天",
    "星期7",
    "週7",
    "周7",
    "禮拜7",
    "礼拜7",
  ],
};

function buildDays(): Record<string, Weekday> {
  const days: Record<string, Weekday> = {};
  for (const [day, forms] of Object.entries(dayForms)) {
    for (const form of forms) {
      days[form] = day as Weekday;
    }
  }
  return days;
}

export const zhSpec: LangSpec = {
  days: buildDays(),
  pluralDays: [], // Chinese doesn't have plural forms in the same way
  ordinals: {
    // Traditional and Simplified
    第一: 1,
    第1: 1,
    第一個: 1,
    第1個: 1,
    第一个: 1,
    第1个: 1,
    第二: 2,
    第2: 2,
    第二個: 2,
    第2個: 2,
    第二个: 2,
    第2个: 2,
    第三: 3,
    第3: 3,
    第三個: 3,
    第3個: 3,
    第三个: 3,
    第3个: 3,
    第四: 4,
    第4: 4,
    第四個: 4,
    第4個: 4,
    第四个: 4,
    第4个: 4,
    第五: 5,
    第5: 5,
    第五個: 5,
    第5個: 5,
    第五个: 5,
    第5个: 5,
    最後: -1,
    最后: -1,
    最後一個: -1,
    最后一个: -1,
    最後1個: -1,
    最后1个: -1,
  },
  numbers: {
    兩: 2,
    两: 2,
    二: 2,
    "2": 2,
    三: 3,
    "3": 3,
    四: 4,
    "4": 4,
    五: 5,
    "5": 5,
    六: 6,
    "6": 6,
  },
  and: ["和", "及", "與", "与", "同"],
  everyTwoIsAmbiguous: false,
  patterns: [
    // Weekly patterns with various prefixes
    {
      template:
        "(?:每週|每周|每個星期|每个星期|每個|每个|每逢|每|逢)\\s*(?:的\\s*)?{DL}(?:\\s*(?:晚|晚上|夜|夜晚|舉行|举行|舉辦|举办))?",
      freq: "WEEKLY",
    },
    // Biweekly patterns
    {
      template:
        "(?:隔週|隔周|每兩週|每两周|每隔一週|每隔一周)\\s*(?:的\\s*)?{DL}(?:\\s*(?:晚|晚上|夜|夜晚|舉行|举行|舉辦|举办))?",
      freq: "WEEKLY",
      interval: 2,
    },
    // Monthly ordinal patterns with 每月/每個月/每个月 optional when starting with 第 or 最
    {
      template:
        "(?:(?:每月|每個月|每个月)\\s*)?{OL}\\s*{D}(?<ofmonth>)(?:\\s*(?:個|个))?(?:\\s*(?:晚|晚上|夜|夜晚|舉行|举行|舉辦|举办))?",
      freq: "MONTHLY",
      ordinal: true,
    },
    // Weekday range patterns
    {
      template: "{D}\\s*(?:至|到|-)\\s*{D}(?:\\s*(?:晚|晚上|夜|夜晚|舉行|举行|舉辦|举办))?",
      freq: "WEEKLY",
      range: true,
    },
    // Weekdays (Monday to Friday)
    {
      template:
        "(?:平日|工作日|週一至週五|周一至周五|星期一至星期五)(?:\\s*(?:晚|晚上|夜|夜晚|舉行|举行|舉辦|举办))?",
      freq: "WEEKLY",
      weekdays: true,
    },
    // Daily
    {
      template: "(?:每日|每天|每晚|每夜)(?:\\s*(?:舉行|举行|舉辦|举办))?",
      freq: "DAILY",
    },
    // Weekly alone
    {
      template: "(?:每週|每周|每個星期|每个星期)(?:\\s*(?:舉行|举行|舉辦|举办))?",
      freq: "WEEKLY",
    },
    // Monthly alone
    {
      template: "(?:每月|每個月|每个月)(?:\\s*(?:舉行|举行|舉辦|举办))?",
      freq: "MONTHLY",
    },
    // Yearly alone
    {
      template: "(?:每年|每個年|每个年)(?:\\s*(?:舉行|举行|舉辦|举办))?",
      freq: "YEARLY",
    },
  ],
};
