/*
 * Creator Scout 独立首页原型 · 演示数据（fixtures）
 * 全部为本轮本地演示数据，不连接任何真实服务。
 * 姓名、邮箱、团队名称、未读数均为示例，集中在此管理，不在组件中散落硬编码。
 *
 * 数据关系（对齐任务单第 7 节建议）：
 *   account        账号级：头像、昵称、注册邮箱、未读数（不随空间切换变化）
 *   spaces         空间级：个人空间 + 最多一个团队空间，各自持有 projects / conversations
 *   membership     账号在团队中的角色（creator / admin / member），决定浮窗显隐
 *   viewState      每个空间独立的会话位置（activeConversationId，null 表示空白会话）
 *   drafts         未发送输入，按 spaceId + conversationId 隔离（空白会话使用 BLANK_DRAFT_ID）
 */
(function (global) {
  'use strict';

  // 空白会话（未创建会话前的默认输入区）使用的草稿键
  var BLANK_DRAFT_ID = '__blank__';

  // ---------------------------------------------------------------------------
  // 主演示账号：已有团队 · 创建者（默认处于团队空间）
  // ---------------------------------------------------------------------------
  var DEMO_ACCOUNT = {
    id: 'acc-lin',
    name: '林小满',
    email: 'xiaoman.lin@example.com',
    avatarInitial: '满',
    unreadCount: 3 // 来自 fixture 状态，不写死在 HTML 中
  };

  var DEMO_TEAM = {
    id: 'team-northstar',
    name: 'Northstar Studio',
    avatarInitial: 'N'
  };

  // 平台入口（Instagram 本轮可用；TikTok / YouTube 仅保留入口）
  var PLATFORMS = [
    { id: 'instagram', label: 'Instagram 达人营销', available: true },
    { id: 'tiktok', label: 'TikTok 达人营销', available: false },
    { id: 'youtube', label: 'YouTube 达人营销', available: false }
  ];

  // ---------------------------------------------------------------------------
  // 两个空间：各自的项目与最近会话（名称刻意不同，便于验证数据隔离）
  // ---------------------------------------------------------------------------
  var DEMO_SPACES = [
    {
      id: 'sp-team-northstar',
      type: 'team',
      name: 'Northstar Studio',
      projects: [
        { id: 'proj-team-aurora', platform: 'instagram', name: 'Aurora Skincare' },
        { id: 'proj-team-trailbrew', platform: 'instagram', name: 'TrailBrew Outdoor' }
      ],
      conversations: [
        {
          id: 'conv-team-aurora',
          projectId: 'proj-team-aurora',
          displayTitle: 'Aurora Skincare',
          dateLabel: '今天 10:25',
          messages: [
            {
              role: 'user',
              text: '我们在北美推广敏感肌护肤线，想找注重成分和皮肤科背书的 Instagram 达人，\n这次先找 80 个，粉丝 5 千到 20 万，需要有公开邮箱。'
            },
            {
              role: 'agent',
              title: '我理解到的目标',
              body: 'Aurora Skincare 正在推广敏感肌护肤线，希望寻找讲解成分、皮肤科背书和温和护肤流程的 Instagram 创作者。\n这些内容会成为项目后续判断达人是否合适的长期标准，也就是“项目画像”。',
              summary: [
                { label: '品牌与产品', value: 'Aurora Skincare · 敏感肌护肤线' },
                { label: '目标市场', value: '北美' },
                { label: '达人方向', value: '成分讲解、皮肤科背书类创作者' }
              ]
            }
          ]
        },
        {
          id: 'conv-team-trailbrew',
          projectId: 'proj-team-trailbrew',
          displayTitle: 'TrailBrew Outdoor',
          dateLabel: '昨天 16:40',
          messages: [
            {
              role: 'user',
              text: '我们做越野跑水袋背包，想找美国trail running社区的 Instagram 达人，\n这轮先找 60 个，粉丝 1 万以上，最好有比赛经历。'
            },
            {
              role: 'agent',
              title: '我理解到的目标',
              body: 'TrailBrew Outdoor 正在推广越野跑水袋背包，希望寻找活跃在美国越野跑与户外耐力运动社区的 Instagram 创作者。\n这些内容会成为项目后续判断达人是否合适的长期标准，也就是“项目画像”。',
              summary: [
                { label: '品牌与产品', value: 'TrailBrew Outdoor · 越野跑水袋背包' },
                { label: '目标市场', value: '美国' },
                { label: '达人方向', value: '越野跑、户外耐力运动创作者' }
              ]
            }
          ]
        }
      ]
    },
    {
      id: 'sp-personal-lin',
      type: 'personal',
      name: '个人空间',
      projects: [
        { id: 'proj-personal-petpal', platform: 'instagram', name: 'PetPal Essentials' },
        { id: 'proj-personal-homecafe', platform: 'instagram', name: 'HomeCafe Lab' }
      ],
      conversations: [
        {
          id: 'conv-personal-petpal',
          projectId: 'proj-personal-petpal',
          displayTitle: 'PetPal Essentials',
          dateLabel: '今天 09:12',
          messages: [
            {
              role: 'user',
              text: '我自己在做一个宠物湿粮小品牌，想找记录日常养猫养狗生活的 Instagram 达人，\n先找 30 个，粉丝 5 千到 10 万，风格真实自然就好。'
            },
            {
              role: 'agent',
              title: '我理解到的目标',
              body: 'PetPal Essentials 正在推广宠物湿粮，希望寻找以真实日常记录为主的养宠类 Instagram 创作者。\n这些内容会成为项目后续判断达人是否合适的长期标准，也就是“项目画像”。',
              summary: [
                { label: '品牌与产品', value: 'PetPal Essentials · 宠物湿粮' },
                { label: '目标市场', value: '未指定（默认全球中文/英文养宠社群）' },
                { label: '达人方向', value: '日常养宠记录类创作者' }
              ]
            }
          ]
        },
        {
          id: 'conv-personal-homecafe',
          projectId: 'proj-personal-homecafe',
          displayTitle: 'HomeCafe Lab',
          dateLabel: '9月22日 15:03',
          messages: [
            {
              role: 'user',
              text: '我想找做家庭咖啡角、手冲器具开箱的 Instagram 达人，帮我推广一个小型磨豆机，\n先找 40 个，粉丝 1 万到 50 万，内容质感要好。'
            },
            {
              role: 'agent',
              title: '我理解到的目标',
              body: 'HomeCafe Lab 正在推广小型磨豆机，希望寻找经营家庭咖啡角、手冲器具评测等内容的 Instagram 创作者。\n这些内容会成为项目后续判断达人是否合适的长期标准，也就是“项目画像”。',
              summary: [
                { label: '品牌与产品', value: 'HomeCafe Lab · 小型磨豆机' },
                { label: '目标市场', value: '未指定' },
                { label: '达人方向', value: '家庭咖啡角、手冲器具类创作者' }
              ]
            }
          ]
        }
      ]
    }
  ];

  // 默认：团队空间（Northstar Studio），与任务单“默认处于团队空间｜创建者”一致
  var DEFAULT_SPACE_ID = 'sp-team-northstar';

  // ---------------------------------------------------------------------------
  // 四态测试夹具：仅用于 tests/tests.html 验证浮窗显隐与顺序，
  // 不进入正式界面，也不提供角色调试开关。
  // 状态命名对齐 account-popover.md 四态矩阵：
  //   creator-default     团队空间 · 创建者（主账号默认态）
  //   personal-with-team  个人空间 · 已有团队
  //   personal-no-team    个人空间 · 无团队
  //   team-member         团队空间 · 普通成员
  //   team-admin          团队空间 · 管理员（复用创建者布局，身份文字为“管理员”）
  // ---------------------------------------------------------------------------
  var POPOVER_TEST_FIXTURES = [
    {
      key: 'creator-default',
      description: '团队空间 · 创建者',
      account: DEMO_ACCOUNT,
      team: DEMO_TEAM,
      membershipRole: 'creator',
      currentSpaceType: 'team'
    },
    {
      key: 'personal-with-team',
      description: '个人空间 · 已有团队',
      account: DEMO_ACCOUNT,
      team: DEMO_TEAM,
      membershipRole: 'creator',
      currentSpaceType: 'personal'
    },
    {
      key: 'personal-no-team',
      description: '个人空间 · 无团队',
      account: DEMO_ACCOUNT,
      team: null,
      membershipRole: null,
      currentSpaceType: 'personal'
    },
    {
      key: 'team-member',
      description: '团队空间 · 普通成员',
      account: DEMO_ACCOUNT,
      team: DEMO_TEAM,
      membershipRole: 'member',
      currentSpaceType: 'team'
    },
    {
      key: 'team-admin',
      description: '团队空间 · 管理员（复用创建者布局）',
      account: DEMO_ACCOUNT,
      team: DEMO_TEAM,
      membershipRole: 'admin',
      currentSpaceType: 'team'
    }
  ];

  // ---------------------------------------------------------------------------
  // 00–05 演示案例数据（本地模拟解析用，与 Figma 02/03 稿一致）。
  // 品牌等输入文本未直接提供的信息标记为「AI建议」；材料内容本轮不做真实解析，
  // 不把任何字段标成「材料提取」。仅当输入命中咖啡机演示特征时使用完整案例。
  // ---------------------------------------------------------------------------
  var DEMO_SIM_CASE = {
    match: /咖啡机|咖啡/,
    conversationTitle: '便携咖啡机达人探索',
    suggestedProjectName: 'OutdoorBrew',
    brand: 'OutdoorBrew',               // 演示建议（输入未提供品牌名）
    product: '便携咖啡机',               // 从「我们做便携咖啡机」提取
    coreValue: '轻量便携、无需固定电源，可在露营、自驾和房车场景快速制作稳定的意式咖啡。',
    targetUsers: '重视便携装备、咖啡品质和户外生活方式的消费者。',
    usageScenarios: '露营地、房车、公路旅行、徒步休息点与户外工作场景。',
    marketingGoal: '建立产品认知，验证真实户外场景中的使用价值，并沉淀可复用内容素材。',
    direction: '户外、露营、房车内容创作者',
    personas: [
      {
        name: '美国户外咖啡达人',
        target: '分享露营、徒步、公路旅行等户外生活内容的创作者',
        topics: '户外装备、露营餐饮、便携咖啡、房车旅行',
        preference: '真实场景体验、清晰产品演示、自然分享',
        audience: '关注户外装备与生活方式的消费者',
        must: '近期持续发布户外内容；账号主体为创作者本人',
        avoid: '搬运号、抽奖聚合号、无法确认真人体验的账号'
      },
      {
        name: '房车与露营装备达人',
        target: '评测房车、露营装备与移动生活产品的创作者',
        topics: '房车生活、露营装备、户外厨房、移动电源',
        preference: '长期体验、参数清楚、真实优缺点',
        audience: '房车用户、露营爱好者和户外装备购买者',
        must: '能展示真实户外使用流程和本人体验',
        avoid: '纯带货聚合、长期无原创内容、品牌不安全内容'
      }
    ]
  };

  // ---------------------------------------------------------------------------
  // 国家／地区字典（对齐 V9 项目画像的结构化 region：以代码存储，中文名用于展示）
  // ---------------------------------------------------------------------------
  var COUNTRY_LIST = [
    ['US', '美国'], ['CA', '加拿大'], ['MX', '墨西哥'],
    ['GB', '英国'], ['IE', '爱尔兰'], ['FR', '法国'], ['DE', '德国'], ['ES', '西班牙'],
    ['PT', '葡萄牙'], ['IT', '意大利'], ['NL', '荷兰'], ['BE', '比利时'], ['CH', '瑞士'],
    ['AT', '奥地利'], ['SE', '瑞典'], ['NO', '挪威'], ['DK', '丹麦'], ['FI', '芬兰'],
    ['IS', '冰岛'], ['PL', '波兰'],
    ['JP', '日本'], ['KR', '韩国'], ['SG', '新加坡'], ['MY', '马来西亚'], ['TH', '泰国'],
    ['VN', '越南'], ['PH', '菲律宾'], ['ID', '印度尼西亚'], ['IN', '印度'],
    ['AU', '澳大利亚'], ['NZ', '新西兰'],
    ['AE', '阿联酋'], ['SA', '沙特阿拉伯'],
    ['BR', '巴西'], ['ZA', '南非']
  ];
  var COUNTRY_MAP = {};
  COUNTRY_LIST.forEach(function (item) { COUNTRY_MAP[item[0]] = item[1]; });

  // 自然语言 → 地区代码的范围规则（与 V9 regionRules 同思路；未命中即无法识别）
  var REGION_RULES = [
    { words: ['北美', '北美洲'], codes: ['US', 'CA'] },
    { words: ['欧洲全域', '全欧洲'], codes: ['GB', 'FR', 'DE', 'ES', 'IT', 'NL', 'SE', 'NO', 'DK', 'FI', 'CH', 'AT', 'PL', 'IE', 'BE', 'PT', 'IS'] },
    { words: ['北欧'], codes: ['SE', 'NO', 'DK', 'FI', 'IS'] },
    { words: ['东南亚'], codes: ['SG', 'MY', 'TH', 'VN', 'PH', 'ID'] },
    { words: ['美国', 'USA', 'U.S.', 'US'], codes: ['US'] },
    { words: ['加拿大'], codes: ['CA'] },
    { words: ['墨西哥'], codes: ['MX'] },
    { words: ['英国', 'UK'], codes: ['GB'] },
    { words: ['爱尔兰'], codes: ['IE'] },
    { words: ['法国'], codes: ['FR'] },
    { words: ['德国'], codes: ['DE'] },
    { words: ['西班牙'], codes: ['ES'] },
    { words: ['葡萄牙'], codes: ['PT'] },
    { words: ['意大利'], codes: ['IT'] },
    { words: ['荷兰'], codes: ['NL'] },
    { words: ['比利时'], codes: ['BE'] },
    { words: ['瑞士'], codes: ['CH'] },
    { words: ['奥地利'], codes: ['AT'] },
    { words: ['瑞典'], codes: ['SE'] },
    { words: ['挪威'], codes: ['NO'] },
    { words: ['丹麦'], codes: ['DK'] },
    { words: ['芬兰'], codes: ['FI'] },
    { words: ['冰岛'], codes: ['IS'] },
    { words: ['波兰'], codes: ['PL'] },
    { words: ['日本'], codes: ['JP'] },
    { words: ['韩国'], codes: ['KR'] },
    { words: ['新加坡'], codes: ['SG'] },
    { words: ['马来西亚'], codes: ['MY'] },
    { words: ['泰国'], codes: ['TH'] },
    { words: ['越南'], codes: ['VN'] },
    { words: ['菲律宾'], codes: ['PH'] },
    { words: ['印度尼西亚', '印尼'], codes: ['ID'] },
    { words: ['印度'], codes: ['IN'] },
    { words: ['澳大利亚', '澳洲'], codes: ['AU'] },
    { words: ['新西兰'], codes: ['NZ'] },
    { words: ['阿联酋'], codes: ['AE'] },
    { words: ['沙特', '沙特阿拉伯'], codes: ['SA'] },
    { words: ['巴西'], codes: ['BR'] },
    { words: ['南非'], codes: ['ZA'] }
  ];

  global.Fixtures = {
    BLANK_DRAFT_ID: BLANK_DRAFT_ID,
    account: DEMO_ACCOUNT,
    team: DEMO_TEAM,
    platforms: PLATFORMS,
    spaces: DEMO_SPACES,
    defaultSpaceId: DEFAULT_SPACE_ID,
    popoverTestFixtures: POPOVER_TEST_FIXTURES,
    simCase: DEMO_SIM_CASE,
    countryList: COUNTRY_LIST,
    countryMap: COUNTRY_MAP,
    regionRules: REGION_RULES
  };
})(window);
