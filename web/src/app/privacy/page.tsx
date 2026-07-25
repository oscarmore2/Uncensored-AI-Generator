import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { getLocale } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const isEnglish = (await getLocale()) === "en";
  const title = isEnglish ? "Privacy & Cookie Policy" : "隐私与 Cookie 政策";
  const description = isEnglish
    ? "How 玩玩可物 handles account data, prompts, uploads, generated media, payments, cookies, and retention."
    : "玩玩可物如何处理账户数据、提示词、上传素材、生成媒体、支付记录、Cookie 与数据保留。";
  return {
    title,
    description,
    alternates: { canonical: "/privacy" },
    openGraph: { type: "website", title, description, url: "/privacy", images: ["/opengraph-image"] },
  };
}

export default async function PrivacyPage() {
  if ((await getLocale()) === "en") {
    return (
      <LegalPage title="Privacy & Cookie Policy" updated="July 26, 2026">
        <p>This policy explains how 玩玩可物 handles account information, device and log data, payments, prompts, uploaded media, and generated output.</p>
        <h2>1. Data we collect</h2>
        <ul>
          <li>Account data: username, email address, password hash, email-verification status, role, membership, acceptance records, and adult-mode settings.</li>
          <li>Social sign-in data: provider account identifier and the name, email address, and profile image returned by Google or Facebook when you choose that sign-in method.</li>
          <li>Registration location estimate: coarse country, region, or city inferred from network address, hosting-provider headers, or our configured IP geolocation provider. We do not collect precise GPS coordinates for this purpose.</li>
          <li>Age verification data: date of birth and verification time submitted when adult mode is enabled.</li>
          <li>Service data: prompts, parameters, uploads, output, task status, and credit transactions.</li>
          <li>Security data: IP address, request information, error logs, anti-abuse signals, and verification results.</li>
          <li>Transaction data: order identifiers, amounts, status, and necessary payment-provider identifiers. We do not store full card details.</li>
        </ul>
        <h2>2. Why we use data</h2>
        <p>We process necessary data to provide the service, secure accounts, prevent fraud and abuse, complete payments, apply regional or legal requirements, enforce content rules, resolve disputes, and meet legal obligations. Coarse registration location may also support aggregated service analytics. Optional cookies or experience data are used only with consent where required.</p>
        <h2>3. Cookies and local storage</h2>
        <p>Necessary cookies support sessions, language preference, security, and service delivery. Optional cookies are enabled only after consent. Your cookie selection is stored locally and the notice will return if browser data is cleared.</p>
        <h2>4. Sharing, transfers, and retention</h2>
        <p>We share only necessary data with hosting, AI inference, object storage, payment, identity, email-delivery, geolocation, verification, and notification providers. When IP geolocation is configured, the registration network address is sent to that provider to obtain a coarse estimate; we store the estimate and source rather than a precise coordinate. If you use social sign-in, Google or Meta processes the login request under its own policy; verification emails are delivered through our configured email provider. Uploads and generated media follow the retention policy and countdown shown in the interface. By default, uploads and unfeatured non-VIP output are kept for seven days, while VIP-created output is retained permanently; administrators may change these settings. Task, prompt, transaction, and security records may remain after media deletion when needed for disputes or law.</p>
        <h2>5. Your rights</h2>
        <p>Subject to applicable law, you may request access, correction, deletion, export, restriction, or objection, and may withdraw optional consent. We may need to verify your identity. Records required by law or fraud prevention may not be deleted immediately.</p>
        <h2>6. Security and contact</h2>
        <p>We use access controls, encrypted transport, protected secrets, and audit measures, but no system is completely secure. Use the published support channel for privacy requests or security reports.</p>
      </LegalPage>
    );
  }
  return (
    <LegalPage title="隐私与 Cookie 政策" updated="2026 年 7 月 26 日">
      <p>
        本政策说明玩玩可物在提供 AI 媒体创作服务时如何处理账户资料、设备与日志信息、支付记录、提示词、上传
        素材及生成结果。
      </p>

      <h2>1. 我们收集的数据</h2>
      <ul>
        <li>账户数据：用户名、邮箱地址、密码哈希、邮箱验证状态、角色、会员状态、条款同意记录及成人模式设置；</li>
        <li>第三方登录数据：你选择 Google 或 Facebook 登录时，服务商返回的账户标识、姓名、邮箱及头像；</li>
        <li>注册所在地推测：根据网络地址、托管平台请求头或配置的 IP 地理服务推测的粗粒度国家、地区或城市；该用途不采集精确 GPS 坐标；</li>
        <li>年龄验证数据：你主动开启成人模式时提交的出生日期及验证时间；</li>
        <li>服务数据：提示词、生成参数、上传素材、生成结果、任务状态与点数流水；</li>
        <li>安全与技术数据：IP 地址、浏览器请求信息、错误日志、反滥用与人机验证结果；</li>
        <li>交易数据：订单号、金额、支付状态及支付服务商返回的必要标识；平台不保存完整银行卡资料。</li>
      </ul>

      <h2>2. 使用目的与依据</h2>
      <p>
        我们为履行服务合同、保障账户与平台安全、防止欺诈与滥用、完成支付、适用地区或法律要求、执行内容政策、
        解决争议及履行法律义务而处理必要数据。注册所在地可用于汇总服务分析；依法需要同意的可选 Cookie 或体验
        优化数据仅在你同意后使用。
      </p>

      <h2>3. Cookie 与本地存储</h2>
      <p>
        必要 Cookie 用于登录会话、语言偏好、安全校验和负载处理，无法通过同意横栏关闭。你的 Cookie 选择保存在浏览器
        本地存储中。可选 Cookie 用于产品分析和体验优化，只有选择“同意并继续”后才应启用。清除浏览器数据后，
        横栏会再次出现。
      </p>

      <h2>4. 共享、跨境与保留</h2>
      <p>
        我们仅向提供云托管、AI 推理、对象存储、支付、身份登录、邮件发送、安全验证和通知服务的处理方共享
        完成服务所必需的数据，并要求其采取适当保护。配置 IP 地理服务时，注册网络地址会发送给该服务商以获得
        粗粒度推测；平台保存推测结果与来源，而非精确坐标。你选择第三方登录时，Google 或 Meta 会按其自身政策处理
        登录请求；验证邮件由平台配置的邮件服务商投递。数据可能在服务商所在地区处理。上传媒体和生成媒体按照界面显示的保留策略与
        倒计时清理；默认情况下上传物及非 VIP 未精选生成媒体保留 7 天，VIP 创建的生成媒体永久保留，管理员
        可调整该策略。媒体文件清理后，任务状态、提示词、交易与安全记录仍可按争议处理和法律要求所需期限
        保留，期满后删除、匿名化或隔离。
      </p>

      <h2>5. 你的权利</h2>
      <p>
        依适用法律，你可请求访问、更正、删除、导出或限制处理个人数据，撤回可选同意，并对特定处理提出异议。
        为保护账户，我们可能需要验证身份；法律要求保留或防止欺诈所需的数据可能无法立即删除。
      </p>

      <h2>6. 安全与联系</h2>
      <p>
        我们采用访问控制、加密传输、密钥保护和审计措施，但任何系统都无法保证绝对安全。如发现安全问题或需
        行使隐私权利，请通过平台公布的客服渠道联系我们。
      </p>
    </LegalPage>
  );
}
