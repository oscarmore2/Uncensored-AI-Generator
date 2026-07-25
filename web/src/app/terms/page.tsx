import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { getLocale } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const isEnglish = (await getLocale()) === "en";
  const title = isEnglish ? "Terms of Service" : "用户条款";
  const description = isEnglish
    ? "Terms governing accounts, AI media generation, credits, subscriptions, content, retention, and platform safety."
    : "玩玩可物关于账户、AI 媒体生成、点数、会员、内容、媒体保留和平台安全的用户条款。";
  return {
    title,
    description,
    alternates: { canonical: "/terms" },
    openGraph: { type: "website", title, description, url: "/terms", images: ["/opengraph-image"] },
  };
}

export default async function TermsPage() {
  if ((await getLocale()) === "en") {
    return (
      <LegalPage title="玩玩可物 Terms of Service" updated="July 26, 2026">
        <p>By registering, signing in, accessing, or using 玩玩可物, you agree to these Terms and our Content Policy. If you do not agree, do not use the service.</p>
        <h2>1. Accounts and eligibility</h2>
        <p>Provide an email address you control, complete verification when required, and protect your credentials. If you use Google or Facebook sign-in, you authorize us to receive the account information needed to create or access your account. At registration, we may infer a coarse country, region, or city from the network address and request metadata for fraud prevention, security, legal compliance, and service analytics. This is an estimate, may be wrong because of VPNs, proxies, mobile networks, or provider databases, and is not proof of nationality, residence, or physical presence. To the extent permitted by law, we do not guarantee its accuracy and are not responsible for decisions made solely from that estimate. You may not sell, rent, or share accounts, or bypass access controls and safety limits. Adult mode is limited to verified users aged 18 or older with active VIP membership.</p>
        <h2>2. Service</h2>
        <p>We provide AI image, video, media generation, editing, storage, and display tools. AI output is probabilistic, and we do not guarantee accuracy, uniqueness, continuous availability, or fitness for a particular purpose.</p>
        <h2>3. Credits, subscriptions, and refunds</h2>
        <p>Credits are usable only within the platform, have no cash value, and are not transferable unless required by law. Tasks consume the displayed credits. Confirmed platform failures may receive automatic refunds. VIP benefits and renewal terms are shown at purchase.</p>
        <h2>4. Your content and media retention</h2>
        <p>You retain rights you lawfully hold in your inputs. You grant us a non-exclusive, worldwide, royalty-free license limited to hosting, processing, transmitting, generating, reviewing, and maintaining the service. Uploads and unfeatured output may be permanently deleted after the countdown shown in the interface. Download anything you wish to keep. VIP output follows the displayed retention policy, while uploads have a separate retention period. Moderator-featured work may be retained for public display.</p>
        <h2>5. Intellectual property and third-party rights</h2>
        <p>You must have the rights needed for anything you upload, enter, or publish. Do not infringe copyright, trademarks, privacy, publicity, confidential information, or other rights. We may remove content or restrict accounts after a valid complaint.</p>
        <h2>6. Safety review and enforcement</h2>
        <p>We may use automated systems and human reviewers to assess prompts, metadata, and public content. We may reject generation, hide or remove content, restrict accounts, and retain or disclose records when required by law or urgent safety concerns.</p>
        <h2>7. Suspension and termination</h2>
        <p>We may suspend or terminate service for violations, fraud, unpaid charges, safety risks, or legal requirements. Obligations incurred before termination continue to apply.</p>
        <h2>8. Disclaimers and liability</h2>
        <p>To the fullest extent permitted by law, the service is provided “as is” and “as available.” We are not liable for indirect, incidental, special, or consequential losses. Review output before publication, commercial use, or important decisions.</p>
        <h2>9. Updates</h2>
        <p>We may update these Terms for product, legal, or safety reasons. Material changes will be communicated reasonably. Mandatory consumer rights remain unaffected.</p>
        <h2>10. Contact and disputes</h2>
        <p>Contact us through the support channel published by the platform. Applicable law, jurisdiction, and mandatory consumer protections depend on the operating entity and your location.</p>
      </LegalPage>
    );
  }
  return (
    <LegalPage title="玩玩可物用户条款" updated="2026 年 7 月 26 日">
      <p>
        欢迎使用玩玩可物。你注册、登录、访问或使用本平台，即表示你已阅读、理解并同意本条款及
        《内容使用条款》。如你不同意，请停止使用服务。
      </p>

      <h2>1. 账户与资格</h2>
      <p>
        你应提供由本人控制的邮箱，按要求完成验证，并妥善保管账户凭据。选择 Google 或 Facebook 登录即表示
        你授权平台接收创建或访问账户所需的第三方账户资料。注册时，平台可根据网络地址、服务商请求头及可选
        地理数据服务粗略推测国家、地区或城市，用于反欺诈、安全、法律合规和服务分析。该结果可能因 VPN、代理、
        移动网络、IP 分配或第三方数据库误差而不准确，不构成对国籍、住所或实际所在位置的证明；在法律允许范围
        内，平台不保证推测结果准确，也不对仅依据该推测结果作出的决定承担责任。账户下发生的活动原则上视为你的行为。发现未经授权的
        使用时，请立即联系我们。你不得出售、出租、共享账户，亦不得绕过访问控制、限额或安全措施。成人模式
        仅限已满 18 岁、完成年龄验证且持有有效 VIP 的用户；你不得代未成年人开启或向其展示相关内容。
      </p>

      <h2>2. 服务说明</h2>
      <p>
        本平台提供 AI 图片、视频及相关媒体生成、编辑、存储和展示服务。生成结果具有概率性，我们不保证结果
        完全准确、唯一、持续可用或适用于特定目的。模型、功能、点数价格和可用范围可能随运营需要调整。
      </p>

      <h2>3. 点数、订阅与退款</h2>
      <p>
        点数仅用于平台内服务，不具货币价值，除法律另有规定外不得转让或兑换现金。提交任务后，系统可按标示
        价格扣除点数；因平台确认的技术故障而失败时可自动退还。VIP 权益、有效期、折扣及续费规则以购买页面
        显示为准。法定退款权利不受本条款限制。
      </p>

      <h2>4. 你的内容与授权</h2>
      <p>
        你保留对合法输入内容所拥有的权利。为提供服务，你授予我们一项非独占、全球范围、免许可费、仅限于
        托管、处理、传输、生成、审核与技术维护所必要的许可。除非你主动公开作品，我们不会将私有作品作为
        社区公开内容展示。上传素材和未精选生成媒体适用创作页显示的保留期限，到期后系统可永久清理；你应在
        倒计时结束前自行下载备份。VIP 创建的生成媒体按购买页及管理策略所示期限保留，但上传素材仍单独适用
        上传物保留期限。被审核员精选的作品可长期保留用于公共展示。
      </p>

      <h2>5. 知识产权与第三方权利</h2>
      <p>
        你必须确保上传、输入和发布的内容不会侵犯他人的著作权、商标权、肖像权、隐私权或其他权利。AI 生成
        内容能否获得知识产权保护取决于适用法律；平台不对权利归属作保证。收到有效投诉后，我们可移除内容、
        限制功能或暂停账户。
      </p>

      <h2>6. 安全审核与执法</h2>
      <p>
        为维护平台安全，我们可使用自动化模型与人工方式审核提示词、元数据和公开内容。系统判定不代表法律
        结论。我们可拒绝生成、隐藏或删除内容、限制账户，并在法律要求或紧急安全风险下保留和披露必要记录。
      </p>

      <h2>7. 暂停与终止</h2>
      <p>
        若你违反条款、造成安全风险、涉嫌欺诈、欠费或法律要求我们采取行动，我们可暂停或终止全部或部分服务。
        你可随时停止使用；终止不影响终止前已产生的义务。
      </p>

      <h2>8. 免责声明与责任限制</h2>
      <p>
        在法律允许的最大范围内，服务按“现状”和“可用”提供。我们不对间接、附带、特殊或后果性损失负责。
        对依法不能排除的责任，本条款不会排除或限制。你应在发布、商业使用或作出重要决定前自行审核生成结果。
      </p>

      <h2>9. 条款更新</h2>
      <p>
        我们可因功能、法律或安全需要更新条款。重大变更会以站内提示或其他合理方式通知；继续使用即表示接受
        更新后的条款。更新不追溯削减法律已赋予你的权利。
      </p>

      <h2>10. 联系与争议</h2>
      <p>
        如对账户、内容或条款有疑问，请通过平台公布的客服渠道联系。争议应先友好协商；适用法律、管辖与消费者
        法定权利以平台运营主体所在地及你所在地强制性规定为准。
      </p>
    </LegalPage>
  );
}
