/* =====================================================================
 *  台灣的尺：一個月生活挑戰 —— 遊戲設定檔
 *  想改數字、文字、教師口白，只要改這個檔案，存檔後重新整理網頁即可。
 *  所有金額單位：新台幣元。
 *  注意：文字請放在引號 "" 裡面；每一行最後的逗號 , 不要刪掉。
 * ===================================================================== */

window.GAME_CONFIG = {

  /* ---------- 一、Firebase 連線設定（連線版才需要） ----------
   * 到 Firebase 控制台 → 專案設定 → 您的應用程式 → 網頁應用程式 → 複製 firebaseConfig，
   * 把裡面的值貼到下面對應的引號中（詳細步驟請看 README.md 第二章）。
   * 全部留空 = 沒有連線，只能使用「單機投影模式」。 */
  firebase: {
  apiKey: "AIzaSyCHUqgPagDpHW_llTwE_AQJV9kjfigSDCA",
  authDomain: "taiwan-ruler.firebaseapp.com",
  databaseURL: "https://taiwan-ruler-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "taiwan-ruler",
  appId: "1:724406871649:web:c953bcb2fed4d3166b2c20"
},

  /* 學生網址的前綴（選填）。
   * QR code 會指向「這個網址/student.html?room=代碼」。
   * 留空 = 自動使用目前老師頁面所在的網址（大多數情況留空即可）。
   * 例："https://yourname.github.io/taiwan-ruler-game/" */
  siteBaseUrl: "",

  /* 步驟 5-3 地圖右下角的「開啟互動地圖」網址；留空 = 不顯示按鈕 */
  worldMapUrl: "https://ourworldindata.org/grapher/share-of-population-in-extreme-poverty?tab=map",

  /* ---------- 二、紅線與補助 ---------- */
  line: {
    perPerson: 15515,        // 最低生活費（每人每月，臺灣省 115 年）
    people: 3,               // 家庭人數（所有家庭都是三人）
    // 資格判斷用：perPerson × people ＝ 46,545；收入「小於」這個數字才符合低收入戶
    midPerPerson: 23273,     // 中低收入戶（最低生活費 × 1.5）每人每月
    midTotal: 69818,         // 中低收入戶三人家庭（隱藏步驟「第二條線」用）
    marginalGap: 5000,       // 收入比紅線多不到這個數字的家庭，視為「邊緣戶（C 類型）」，會看到不符資格通知與心情按鈕
    region: "臺灣省",
    year: "115"
  },

  /* 補助金額（遊戲設定）。老師也可以在控制台「設定」裡即時修改。
   * mode: "cover" = 剛好把該家庭的債務補到 0（預設）
   *       "fixed" = 每個符合資格的家庭都發固定金額 fixed 元 */
  subsidy: { mode: "cover", fixed: 10000 },

  /* 預設組數（4、5 或 6）。開新的一局時會先用這個數字；老師也可以在控制台「設定」裡改。
   * 4 組用 A～D，5 組加 E，6 組再加 F。 */
  defaultGroups: 6,

  /* 計算模式預設值（學生繳費前要先算出剩多少錢）；老師可在控制台開關 */
  calcMode: true,

  /* ---------- 三、家庭 ----------
   * 順序很重要：4 組用前 4 個（A～D），5 組加 E，6 組加 E、F。
   * emoji：圖片載入失敗時，用代表色圓形加這組 emoji 代替。 */
  families: [
    { code: "A", name: "小明家", intro: "媽媽單親扶養兩個小孩，在餐廳兼職",
      income: 38000, img: "assets/family_a.jpg",  color: "#E8833A", emoji: "👩👦👧" },
    { code: "B", name: "小華家", intro: "阿公打零工扶養兩個孫子",
      income: 30000, img: "assets/family_b.jpg",  color: "#3F7FC4", emoji: "👴👦👦" },
    { code: "C", name: "小美家", intro: "爸爸開貨車，媽媽在家照顧小美",
      income: 47000, img: "assets/family_c.jpg",  color: "#D4527F", emoji: "👨👩👧" },
    { code: "D", name: "小安家", intro: "爸媽都是上班族",
      income: 90000, img: "assets/family_d.jpg",  color: "#239A8F", emoji: "👨👩👦" },
    { code: "E", name: "小芳家", intro: "爸爸單親，在工廠輪班，扶養兩個小孩",
      income: 38000, img: "assets/family_a2.jpg", color: "#D9A400", emoji: "👨👦👧" },
    { code: "F", name: "小傑家", intro: "媽媽在超市上班，爸爸腳受傷暫時不能工作，在家照顧小傑",
      income: 47000, img: "assets/family_c2.jpg", color: "#7A5CC7", emoji: "👩👨👦" }
  ],

  /* ---------- 四、必要帳單（依序公布，各組金額相同） ---------- */
  bills: [
    { cat: "住的費用",         name: "租一間小公寓",                 amount: 12000, icon: "🏠" },
    { cat: "住的費用",         name: "水電、瓦斯、手機網路",         amount: 3000,  icon: "💡" },
    { cat: "吃飯、上學與交通", name: "三個人一個月的飯錢",           amount: 21000, icon: "🍱",
      note: "每人每天約 230 元，吃最簡單的便當或自己煮" },
    { cat: "吃飯、上學與交通", name: "機車油錢與交通",               amount: 3000,  icon: "🛵" },
    { cat: "吃飯、上學與交通", name: "小朋友文具、學校雜費與保險",   amount: 3000,  icon: "✏️" }
  ],

  /* ---------- 五、命運事件（全班同一張） ---------- */
  fate: {
    title: "命運事件",
    text: "機車壞了要修 4,000 元，家裡又有人牙痛看醫生 2,000 元！",
    amount: 6000,
    img: "assets/event_fate.jpg",
    icon: "🎲"
  },

  /* ---------- 六、心情按鈕（步驟 4-4） ---------- */
  moods: [
    { key: "angry",    emoji: "😠", label: "生氣" },
    { key: "sad",      emoji: "😢", label: "難過" },
    { key: "confused", emoji: "😕", label: "不懂" },
    { key: "unfair",   emoji: "😤", label: "不公平" },
    { key: "custom",   emoji: "✏️", label: "自訂一句話" }
  ],

  /* ---------- 七、畫面文字 ---------- */
  texts: {
    gameTitle: "台灣的尺：一個月生活挑戰",
    billFootnote: "金額為課堂簡化的設定，實際花費每個家庭都不一樣。",
    // 4-1 說明文字（數字用 {line}、{perPerson} 會自動帶入）
    line1Text: "臺東縣適用臺灣省標準，115 年最低生活費每人每月 {perPerson} 元。三人家庭 × 3 ＝ {line} 元。全家收入平均下來比這條線低，就可以申請成為低收入戶。",
    subsidyTitle: "低收入戶生活補助",
    reverseQuestion: "小美家和小明家一樣在欠債，為什麼拿不到補助？這樣公平嗎？",
    moodPromptC: "說說看，你們現在的心情是？",
    moodPromptOthers: "想一想：如果你是小美家，你的心情是？",
    marginalText: "收入剛好在線上一點點、卻同樣過得很辛苦的家庭，常被稱為「邊緣戶」。",
    marginalText2: "任何一條線，都會有剛好落在線外的人。",
    world1: "世界銀行另外畫了一條全世界通用的線：每人每天 3 美元。",
    world2a: "用匯率換算，大約是台幣 90 多元。",
    world2tag: "約 90 元",
    world2b: "一整天的生活，就只有這些。",
    world3: "全世界大約有 8 億人生活在這條線以下，大多在撒哈拉以南非洲和南亞的部分地區。",
    world4: "聯合國訂下的第一個永續發展目標，就是消除貧窮",
    summaryTW: { title: "台灣的尺", big: "15,515 元", sub: "每人每月", desc: "最低生活費（臺灣省 115 年），是低收入戶的門檻" },
    summaryWorld: { title: "世界的尺", big: "3 美元", sub: "每人每天", desc: "世界銀行的「極端貧窮線」" },
    summaryNext: "每個國家也都有自己的尺。下一節課，每組會抽到一個國家，看看他們的及格線畫在哪裡！",
    endStudent: "今天的挑戰結束了！",
    line2Text: "中低收入戶：最低生活費的 1.5 倍以內，臺灣省每人每月 23,273 元，三人家庭約 69,818 元。",
    line2Callout: "小美家可以申請中低收入戶，獲得部分健保費與學雜費補助"
  },

  /* ---------- 八、教師口白提示（只在老師的控制模式顯示） ----------
   * say = 可以對全班說的話；tip = 提醒老師的事。
   * 鍵名對應步驟：lobby、draw、bills、fate、line1、sub2、rev3、mood、marg、world、sum、line2 */
  notes: {
    lobby: [
      { say: "今天每組要扮演一個「三人家庭」，挑戰在台灣能不能順利生活一個月！" },
      { tip: "身分用抽籤決定，不討論自己家裡的經濟狀況。" }
    ],
    draw: [
      { say: "請各組念出自己家的介紹和月收入。" }
    ],
    bills: [
      { say: "金額是課堂簡化的設定，實際花費每個家庭都不一樣。" },
      { say: "帳單繳完後問：哪一組開始欠錢了？" }
    ],
    fate: [
      { say: "生活中總有意外。" },
      { tip: "翻牌後請 C 組說說現在的狀況。" }
    ],
    line1: [
      { tip: "補充（教師備查）：最低生活費為當地每人可支配所得中位數的 60%；實際審核還會看存款、房地等財產。" }
    ],
    sub2: [
      { tip: "只有收入在線下的家庭會拿到補助；其他組請他們先看大螢幕。" }
    ],
    rev3: [
      { tip: "若沒有學生提出「只多一點點錢，卻什麼都拿不到」，請 C 組說說心情。" }
    ],
    mood: [
      { tip: "帶出「邊緣戶」：任何一條線都會有剛好落在線外的人。" },
      { tip: "如果有不適合投影的回應，可在控制台「各組狀態」按「隱藏回應」。" }
    ],
    marg: [
      { tip: "帶出「邊緣戶」：任何一條線都會有剛好落在線外的人。" }
    ],
    world: [
      { tip: "地圖顯示的是「比例」不是「人數」：南亞比例不高、顏色很淺，但人口很多，所以人數也不少。台灣不在世界銀行的統計範圍內，所以沒有顏色。" },
      { tip: "避免以「非洲＝貧窮」概括，指出具體地區即可。" }
    ],
    sum: [
      { say: "預告第三節：每組會抽到一個國家，看看他們的及格線畫在哪裡。" }
    ],
    line2: [
      { tip: "第四節課用的隱藏步驟：從這裡按「上一步」可回到總結。" }
    ]
  }
};
