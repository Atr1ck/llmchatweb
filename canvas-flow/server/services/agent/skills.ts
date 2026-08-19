import type { CreativeAgentContext, SkillRef } from "./types";

export type CreativeSkill = SkillRef & {
  description: string;
  triggerTerms: string[];
  promptGuidance: string;
  negativeGuidance: string;
  parameterHints: string;
  conflictsWith?: string[];
};

const skills: CreativeSkill[] = [
  {
    id: "lighting-enhancement",
    version: "1.0.0",
    name: "光影强化",
    summary: "强化主光、轮廓光与明暗层次，让主体从背景中脱离出来。",
    description: "适合需要更有戏剧性、层次感或主体突出效果的创作。",
    triggerTerms: ["光影", "光线", "轮廓光", "逆光", "戏剧", "明暗", "氛围"],
    promptGuidance: "明确主光方向、光质、色温和主体边缘光，保持高光受控、阴影有细节。",
    negativeGuidance: "避免过曝、死黑阴影、塑料质感、无来源的彩色光污染。",
    parameterHints: "优先使用清晰的主光方向和柔和的补光。",
  },
  {
    id: "cinematic-color",
    version: "1.0.0",
    name: "电影感色彩",
    summary: "建立统一的电影调色、色温对比和情绪色彩。",
    description: "适合电影海报、叙事场景和需要明确情绪的画面。",
    triggerTerms: ["电影感", "电影", "胶片", "色调", "情绪", "低饱和", "大片"],
    promptGuidance: "指定主色与辅助色，控制饱和度和对比度，让色彩服务于叙事重点。",
    negativeGuidance: "避免颜色脏乱、过度饱和、廉价滤镜感、肤色偏色。",
    parameterHints: "保持全画面色彩系统统一，避免随意增加颜色。",
    conflictsWith: ["commercial-cleanup"],
  },
  {
    id: "lens-and-camera",
    version: "1.0.0",
    name: "镜头辅助",
    summary: "补全焦段、机位、视角和摄影语言，让画面更像真实拍摄。",
    description: "适合人像、产品、场景和需要明确镜头感的创作。",
    triggerTerms: ["镜头", "焦段", "广角", "长焦", "特写", "低机位", "高机位", "摄影"],
    promptGuidance: "根据主体和空间关系选择合理焦段、机位、视角与透视，不堆叠互相矛盾的镜头词。",
    negativeGuidance: "避免畸变、透视冲突、错误景别、主体比例失真。",
    parameterHints: "人像优先考虑 50mm/85mm 语义，环境叙事可考虑 24mm/35mm 语义。",
  },
  {
    id: "composition-optimization",
    version: "1.0.0",
    name: "构图优化",
    summary: "强化主体层级、视觉动线、留白和画面平衡。",
    description: "适合构图松散、主体不突出或需要海报感的画面。",
    triggerTerms: ["构图", "布局", "留白", "视觉中心", "海报", "平衡", "动线"],
    promptGuidance: "明确主体位置、前中后景关系、视觉动线与留白用途，避免只使用抽象构图术语。",
    negativeGuidance: "避免主体被裁切、视觉中心分散、边缘杂物和空间关系混乱。",
    parameterHints: "根据用途选择居中、三分法、对角线或对称构图。",
  },
  {
    id: "depth-and-focus",
    version: "1.0.0",
    name: "景深与主体突出",
    summary: "通过景深、焦点和前后景关系强化主体阅读顺序。",
    description: "适合人像、产品和需要突出单一主体的画面。",
    triggerTerms: ["景深", "虚化", "焦点", "主体突出", "背景虚化", "清晰"],
    promptGuidance: "明确焦点落在主体关键区域，控制背景虚化程度并保留必要环境信息。",
    negativeGuidance: "避免全画面糊、焦点错位、主体边缘融入背景、过度奶油虚化。",
    parameterHints: "主体清晰、背景适度退后，景深服务于叙事而非单纯炫技。",
  },
  {
    id: "material-detail",
    version: "1.0.0",
    name: "材质与细节增强",
    summary: "补足材质、纹理、微细节和真实触感。",
    description: "适合产品、建筑、服装、食物和需要质感的画面。",
    triggerTerms: ["材质", "质感", "纹理", "细节", "金属", "皮革", "玻璃", "布料"],
    promptGuidance: "明确材质属性、表面反射、粗糙度和细节尺度，保持细节与画面风格一致。",
    negativeGuidance: "避免过度锐化、噪点、重复纹理、材质混淆和不合逻辑反射。",
    parameterHints: "先保证大形体和光影，再补充材质细节。",
  },
  {
    id: "portrait-refinement",
    version: "1.0.0",
    name: "人像优化",
    summary: "优化面部结构、肤质、表情、姿态和人物一致性。",
    description: "适合人物变体、肖像和需要稳定人物身份的创作。",
    triggerTerms: ["人像", "人物", "脸", "面部", "皮肤", "肖像", "表情", "姿态"],
    promptGuidance: "保留身份特征和自然皮肤纹理，明确表情、姿态、视线和服装关系。",
    negativeGuidance: "避免蜡像皮肤、面部变形、额外手指、五官不对称和身份漂移。",
    parameterHints: "优先保证人物身份和姿态，再追求风格化。",
  },
  {
    id: "multi-image-consistency",
    version: "1.0.0",
    name: "多图融合一致性",
    summary: "统一多张参考图的主体、光线、透视、色彩和材质。",
    description: "适合多图融合、风格迁移和延续已有画布系列。",
    triggerTerms: ["融合", "合成", "一致", "统一", "系列", "参考图", "延续", "变体"],
    promptGuidance: "明确每张参考图的角色，统一光源、透视、色温和风格，避免机械拼贴。",
    negativeGuidance: "避免拼贴边界、光线方向冲突、比例不一致、风格断裂和重复主体。",
    parameterHints: "多图 merge 时优先保证主体关系和统一光影。",
  },
];

function tokens(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9\u4e00-\u9fff]+/gi) ?? [];
}

export function getCreativeSkills(): CreativeSkill[] {
  return skills.map((skill) => ({ ...skill, triggerTerms: [...skill.triggerTerms] }));
}

export function normalizeSkillId(value: string): string {
  const at = value.lastIndexOf("@");
  return at > 0 ? value.slice(0, at) : value;
}

export function versionedSkillId(skill: CreativeSkill): string {
  return `${skill.id}@${skill.version}`;
}

export function getSkillById(id: string): CreativeSkill | undefined {
  return skills.find((skill) => skill.id === normalizeSkillId(id));
}

export function toSkillRef(skill: CreativeSkill): SkillRef {
  return { id: skill.id, version: skill.version, name: skill.name, summary: skill.summary };
}

export function retrieveCreativeSkills(
  query: string,
  context: CreativeAgentContext = {},
  limit = 4
): CreativeSkill[] {
  const requested = new Set((context.requestedSkillIds ?? []).map(normalizeSkillId));
  const queryText = [
    query,
    ...(context.selectedAssets ?? []).map((asset) => asset.prompt ?? ""),
    context.project?.styleBible?.direction ?? "",
    context.project?.styleBible?.lighting ?? "",
    context.project?.styleBible?.composition ?? "",
  ].join(" ").toLowerCase();
  const queryTokens = new Set(tokens(queryText));

  return skills
    .map((skill) => {
      const triggerHits = skill.triggerTerms.filter((term) => queryText.includes(term.toLowerCase())).length;
      const tagHits = skill.triggerTerms.reduce((count, term) => count + (queryTokens.has(term.toLowerCase()) ? 1 : 0), 0);
      const requestedBoost = requested.has(skill.id) ? 100 : 0;
      return { skill, score: requestedBoost + triggerHits * 8 + tagHits * 3 };
    })
    .sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id))
    .filter(({ score }) => score > 0)
    .slice(0, Math.min(limit, skills.length))
    .map(({ skill }) => skill);
}

export function formatSkillKnowledge(skillsToFormat: CreativeSkill[]): string {
  if (!skillsToFormat.length) return "未检索到额外创作 Skill，请使用基础摄影与设计常识。";
  return skillsToFormat.map((skill) => [
    `- ${skill.id}@${skill.version}（${skill.name}）：${skill.description}`,
    `  提示词策略：${skill.promptGuidance}`,
    `  避免项：${skill.negativeGuidance}`,
    `  参数建议：${skill.parameterHints}`,
  ].join("\n")).join("\n");
}
