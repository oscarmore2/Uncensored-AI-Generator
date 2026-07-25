import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { getLocale } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const isEnglish = (await getLocale()) === "en";
  const title = isEnglish ? "Content Policy" : "内容使用条款";
  const description = isEnglish
    ? "Rules for prompts, uploads, AI-generated media, public creations, safety classification, and adult mode."
    : "玩玩可物关于提示词、上传素材、AI 生成媒体、公开作品、安全分类和成人模式的内容规则。";
  return {
    title,
    description,
    alternates: { canonical: "/content-policy" },
    openGraph: { type: "website", title, description, url: "/content-policy", images: ["/opengraph-image"] },
  };
}

export default async function ContentPolicyPage() {
  if ((await getLocale()) === "en") {
    return (
      <LegalPage title="玩玩可物 Content Policy" updated="July 25, 2026">
        <p>This policy applies to prompts, uploads, generated output, public creations, and other content submitted to the platform. You are responsible for your content and how you use it.</p>
        <h2>1. Prohibited content</h2>
        <p>You must not request, upload, generate, edit, share, or facilitate:</p>
        <ul>
          <li>Sexualized content involving minors or people who cannot clearly be identified as adults.</li>
          <li>Non-consensual intimate media, face swaps, undressing, voyeurism, sexual humiliation, or sexualized content involving real people without consent.</li>
          <li>Hate, harassment, threats, fraud, illegal trade, terrorism promotion, or facilitation of crime.</li>
          <li>Content that violates intellectual property, privacy, publicity, confidential information, or other third-party rights.</li>
          <li>Attempts to bypass age verification or access controls, or expose minors to adult content.</li>
        </ul>
        <h2>2. Adult mode</h2>
        <p>Only active VIP users who complete 18+ verification may enable adult mode. It may be used only for clearly adult, fictional, or authorized subjects. Content involving minors or non-consensual conduct is always prohibited.</p>
        <h2>3. Real people and synthetic media</h2>
        <p>Obtain all necessary consent before using a real person’s likeness or voice. Do not create deceptive impersonation, defamation, political manipulation, fraud, or non-consensual sensitive synthetic media. Clearly disclose AI generation or editing where appropriate.</p>
        <h2>4. Review system</h2>
        <p>Generation requests are classified when submitted to determine whether output requires an 18+ label. Accounts without adult mode are blocked from adult, sexual, or realistic graphic content. Adult-mode classifications control labels and display treatment, while content involving minors or non-consensual activity remains blocked. 18+ work is returned only to eligible VIP accounts and is blurred by default.</p>
        <h2>5. Enforcement and appeals</h2>
        <p>Violations may lead to rejection, hiding or deletion, loss of publishing privileges, restrictions, suspension, or termination. You may request review through the support channel with the prompt, task number, and relevant context.</p>
      </LegalPage>
    );
  }
  return (
    <LegalPage title="玩玩可物内容使用条款" updated="2026 年 7 月 25 日">
      <p>
        本条款适用于你提交的提示词、上传素材、生成结果、公开作品及与平台互动时产生的其他内容。你对内容及其
        使用方式负责，并应遵守适用法律和第三方平台规则。
      </p>

      <h2>1. 禁止内容</h2>
      <p>不得请求、上传、生成、编辑、分享或协助传播以下内容：</p>
      <ul>
        <li>任何涉及未成年人的性化内容，或无法明确确认成年人身份的性化人物；</li>
        <li>未经同意的亲密影像、换脸、脱衣、偷窥、性羞辱或以真实人物为对象的性化内容；</li>
        <li>仇恨、骚扰、威胁、欺诈、非法交易、恐怖主义宣传或促进违法行为的内容；</li>
        <li>侵犯知识产权、隐私、肖像、商业秘密或其他第三方权利的内容；</li>
        <li>恶意规避年龄验证、访问控制，或向未成年人展示、传播成人作品的行为。</li>
      </ul>

      <h2>2. 成人模式</h2>
      <p>
        只有有效 VIP 且完成 18 岁验证的用户可以主动开启成人模式。成人模式允许创作仅涉及明确成年、虚构或
        已获授权人物的成人主题；系统不会因一般成人或血腥分类而阻断生成，但仍会分类并标记作品。关闭成人
        模式、VIP 失效或年龄验证不通过时，成人内容请求会被拒绝。
      </p>

      <h2>3. 真实人物与合成媒体</h2>
      <p>
        使用真实人物的形象或声音前，你必须取得必要授权。不得制作足以误导公众的冒充、诽谤、政治操纵、诈骗
        或未经同意的敏感合成媒体。对外发布时，应在合理情况下清楚标示内容由 AI 生成或编辑。
      </p>

      <h2>4. 审核机制</h2>
      <p>
        所有生成请求都会在提交时进行内容分类，以决定作品是否标记为 18+。未开启成人模式的账户命中成人、
        色情或写实血腥类别时，任务不会提交，也不会扣除点数。成人模式下分类只用于标记和显示控制，不阻断
        一般成人内容；涉及未成年人或非自愿性内容始终禁止。18+ 作品只会向已开启成人模式的 VIP 查询返回，
        且默认以模糊预览显示。
      </p>

      <h2>5. 处理措施与申诉</h2>
      <p>
        违反本条款可能导致请求被拒、内容被隐藏或删除、公开资格被取消、功能受限、账户暂停或终止。对自动化
        判断有异议时，可通过客服渠道提交提示词、任务编号和必要说明申请复核。严重或重复违规可不经预警处理。
      </p>
    </LegalPage>
  );
}
