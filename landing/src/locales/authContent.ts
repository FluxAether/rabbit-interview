export type AuthLang = 'en' | 'zh-CN' | 'zh-TW'

type AuthCopy = {
  htmlLang: string
  title: string
  backHome: string
  loading: string
  retry: string
  login: {
    title: string
    subtitle: string
    email: string
    password: string
    submit: string
    forgot: string
    register: string
    desktopOnlyTitle: string
    desktopOnlyBody: string
    successTitle: string
    successBody: string
    mfaTitle: string
    mfaHelp: string
    code: string
    consentTitle: string
    consentHelp: string
    allow: string
    deny: string
  }
  scopes: Record<string, string>
  register: {
    title: string
    subtitle: string
    name: string
    email: string
    submit: string
    sentTitle: string
    sentBody: string
    existing: string
    signIn: string
  }
  forgot: {
    title: string
    subtitle: string
    email: string
    submit: string
    sentTitle: string
    sentBody: string
    backToSignIn: string
  }
  password: {
    setupTitle: string
    resetTitle: string
    subtitle: string
    value: string
    confirm: string
    submit: string
    savedTitle: string
    savedBody: string
  }
  security: {
    title: string
    subtitle: string
    account: string
    enabled: string
    disabled: string
    start: string
    setupTitle: string
    setupHelp: string
    secret: string
    code: string
    confirm: string
    recoveryTitle: string
    recoveryHelp: string
    password: string
    factor: string
    disable: string
    revoke: string
    disabledDone: string
    revokedDone: string
  }
  signedOut: {
    title: string
    body: string
  }
  subscribe: {
    title: string
    subtitle: string
    hostedTitle: string
    hostedBody: string
    byokTitle: string
    byokBody: string
    grantTitle: string
    grantBody: string
    paymentsNote: string
    signedOut: string
    signedIn: string
    stt: string
    llm: string
    paymentsOff: string
    monthPlan: string
    quarterPlan: string
    days: string
    sttMinutes: string
    llmUnits: string
    buy: string
    redirecting: string
    currentPlan: string
    paidThrough: string
    paymentPending: string
    paymentPaid: string
    paymentClosed: string
  }
  admin: {
    title: string
    subtitle: string
    token: string
    actor: string
    email: string
    lookup: string
    account: string
    status: string
    sttMinutes: string
    reason: string
    validUntil: string
    grant: string
    granted: string
  }
  errorTitle: string
  errors: Record<string, string>
}

const sharedErrors = {
  en: {
    MISSING_REQUEST: 'Open sign-in from the Rabbit Interview desktop app.',
    REQUEST_EXPIRED: 'This request expired. Start sign-in again from the desktop app.',
    BAD_CREDENTIALS: 'Email or password is incorrect.',
    VERIFICATION_EXPIRED: 'The verification request expired. Sign in again.',
    PASSWORD_REQUIRED: 'Sign in with your password first.',
    ACCOUNT_UNAVAILABLE: 'This account is unavailable.',
    MFA_INCORRECT: 'The authenticator or recovery code is incorrect.',
    AUTHORIZATION_EXPIRED: 'The authorization request expired.',
    AUTH_REQUIRED: 'Sign in through Rabbit Interview before opening account security.',
    INVALID_EMAIL: 'Enter a valid email address.',
    INVALID_DISPLAY_NAME: 'Enter a display name of no more than 128 characters.',
    INVALID_OR_EXPIRED_LINK: 'This link is invalid or has expired.',
    PASSWORD_MISMATCH: 'The passwords do not match.',
    INVALID_PASSWORD: 'Use a password between 12 and 128 characters.',
    TOTP_ALREADY_ENABLED: 'Authenticator MFA is already enabled.',
    TOTP_RESTART: 'Start authenticator setup again.',
    TOTP_INCORRECT: 'The verification code is incorrect.',
    DISABLE_MFA_FAILED: 'The password or verification code is incorrect.',
    AUTHORIZATION_USED: 'This authorization request has already been used.',
    INVALID_CLIENT: 'The sign-in client or callback is invalid.',
    INVALID_REQUEST: 'The sign-in request is invalid.',
    INVALID_LOGOUT: 'The sign-out request is invalid.',
    INVALID_POST_LOGOUT: 'The sign-out callback is invalid.',
    RATE_LIMITED: 'Too many attempts. Try again later.',
    INTERNAL_ERROR: 'Unable to continue right now. Try again later.',
    NETWORK_ERROR: 'Unable to reach the account service. Check your connection and try again.',
    ACCOUNT_SUSPENDED: 'This account cannot receive hosted quota.',
    SESSION_NOT_FOUND: 'No account matches that email.',
    IDEMPOTENCY_CONFLICT: 'This checkout request conflicts with an earlier request. Try again.',
    PROVIDER_UNAVAILABLE: 'Alipay is temporarily unavailable. Try again later.',
    PROVIDER_PROTOCOL_ERROR: 'The payment result could not be verified. Refresh this page later.',
  },
  zhCN: {
    MISSING_REQUEST: '请从 Rabbit Interview 桌面应用发起登录。',
    REQUEST_EXPIRED: '请求已过期，请从桌面应用重新登录。',
    BAD_CREDENTIALS: '邮箱或密码不正确。',
    VERIFICATION_EXPIRED: '验证请求已过期，请重新登录。',
    PASSWORD_REQUIRED: '请先使用密码登录。',
    ACCOUNT_UNAVAILABLE: '该账号当前不可用。',
    MFA_INCORRECT: '验证器或恢复码不正确。',
    AUTHORIZATION_EXPIRED: '授权请求已过期。',
    AUTH_REQUIRED: '请先通过 Rabbit Interview 登录，再打开账号安全页面。',
    INVALID_EMAIL: '请输入有效的邮箱地址。',
    INVALID_DISPLAY_NAME: '请输入不超过 128 个字符的显示名称。',
    INVALID_OR_EXPIRED_LINK: '此链接无效或已过期。',
    PASSWORD_MISMATCH: '两次输入的密码不一致。',
    INVALID_PASSWORD: '密码长度必须为 12–128 个字符。',
    TOTP_ALREADY_ENABLED: '验证器 MFA 已启用。',
    TOTP_RESTART: '请重新开始验证器设置。',
    TOTP_INCORRECT: '验证码不正确。',
    DISABLE_MFA_FAILED: '密码或验证码不正确。',
    AUTHORIZATION_USED: '此授权请求已被使用。',
    INVALID_CLIENT: '登录客户端或回调地址无效。',
    INVALID_REQUEST: '登录请求无效。',
    INVALID_LOGOUT: '退出请求无效。',
    INVALID_POST_LOGOUT: '退出后的回调地址无效。',
    RATE_LIMITED: '尝试次数过多，请稍后再试。',
    INTERNAL_ERROR: '暂时无法继续，请稍后重试。',
    NETWORK_ERROR: '无法连接账号服务，请检查网络后重试。',
    ACCOUNT_SUSPENDED: '该账号当前不能发放云托管额度。',
    SESSION_NOT_FOUND: '没有匹配该邮箱的账号。',
    IDEMPOTENCY_CONFLICT: '本次支付请求与先前请求冲突，请重试。',
    PROVIDER_UNAVAILABLE: '支付宝暂时不可用，请稍后重试。',
    PROVIDER_PROTOCOL_ERROR: '支付结果暂时无法验证，请稍后刷新本页。',
  },
  zhTW: {
    MISSING_REQUEST: '請從 Rabbit Interview 桌面應用程式發起登入。',
    REQUEST_EXPIRED: '請求已過期，請從桌面應用程式重新登入。',
    BAD_CREDENTIALS: '電子郵件或密碼不正確。',
    VERIFICATION_EXPIRED: '驗證請求已過期，請重新登入。',
    PASSWORD_REQUIRED: '請先使用密碼登入。',
    ACCOUNT_UNAVAILABLE: '此帳號目前無法使用。',
    MFA_INCORRECT: '驗證器或復原碼不正確。',
    AUTHORIZATION_EXPIRED: '授權請求已過期。',
    AUTH_REQUIRED: '請先透過 Rabbit Interview 登入，再開啟帳號安全頁面。',
    INVALID_EMAIL: '請輸入有效的電子郵件地址。',
    INVALID_DISPLAY_NAME: '請輸入不超過 128 個字元的顯示名稱。',
    INVALID_OR_EXPIRED_LINK: '此連結無效或已過期。',
    PASSWORD_MISMATCH: '兩次輸入的密碼不一致。',
    INVALID_PASSWORD: '密碼長度必須為 12–128 個字元。',
    TOTP_ALREADY_ENABLED: '驗證器 MFA 已啟用。',
    TOTP_RESTART: '請重新開始驗證器設定。',
    TOTP_INCORRECT: '驗證碼不正確。',
    DISABLE_MFA_FAILED: '密碼或驗證碼不正確。',
    AUTHORIZATION_USED: '此授權請求已被使用。',
    INVALID_CLIENT: '登入用戶端或回呼網址無效。',
    INVALID_REQUEST: '登入請求無效。',
    INVALID_LOGOUT: '登出請求無效。',
    INVALID_POST_LOGOUT: '登出後的回呼網址無效。',
    RATE_LIMITED: '嘗試次數過多，請稍後再試。',
    INTERNAL_ERROR: '暫時無法繼續，請稍後再試。',
    NETWORK_ERROR: '無法連線帳號服務，請檢查網路後再試。',
    ACCOUNT_SUSPENDED: '此帳號目前不能發放雲端代管額度。',
    SESSION_NOT_FOUND: '沒有符合此電子郵件的帳號。',
    IDEMPOTENCY_CONFLICT: '本次付款請求與先前請求衝突，請重試。',
    PROVIDER_UNAVAILABLE: '支付寶暫時無法使用，請稍後重試。',
    PROVIDER_PROTOCOL_ERROR: '付款結果暫時無法驗證，請稍後重新整理本頁。',
  },
} as const

export const authCopy: Record<AuthLang, AuthCopy> = {
  en: {
    htmlLang: 'en',
    title: 'Rabbit Interview account',
    backHome: 'Back to Rabbit Interview',
    loading: 'Loading…',
    retry: 'Try again',
    login: {
      title: 'Sign in',
      subtitle: 'Continue securely to the Rabbit Interview desktop app.',
      email: 'Email',
      password: 'Password',
      submit: 'Sign in',
      forgot: 'Forgot password?',
      register: 'Create an account',
      desktopOnlyTitle: 'Open Rabbit Interview to sign in',
      desktopOnlyBody: 'This page continues a desktop sign-in request. Register here, then sign in from the app.',
      successTitle: 'Sign-in successful',
      successBody: 'You can return to Rabbit Interview. This browser tab is no longer needed.',
      mfaTitle: 'Verify sign-in',
      mfaHelp: 'Enter an authenticator or recovery code.',
      code: 'Verification code',
      consentTitle: 'Authorize Rabbit Interview',
      consentHelp: 'The desktop app is requesting permission to:',
      allow: 'Allow',
      deny: 'Deny',
    },
    scopes: {
      openid: 'Confirm your identity',
      profile: 'Read your display name',
      email: 'Read your email address',
      offline_access: 'Keep you signed in on this device',
    },
    register: {
      title: 'Create your account',
      subtitle: 'We will email a one-time link to verify your address and set a password.',
      name: 'Display name',
      email: 'Email',
      submit: 'Create account',
      sentTitle: 'Check your email',
      sentBody: 'If the address can be registered, a setup link has been sent.',
      existing: 'Already have an account?',
      signIn: 'Sign in',
    },
    forgot: {
      title: 'Reset your password',
      subtitle: 'Enter your account email and we will send a one-time reset link.',
      email: 'Email',
      submit: 'Send reset link',
      sentTitle: 'Check your email',
      sentBody: 'If the account exists, a reset link has been sent.',
      backToSignIn: 'Back to sign in',
    },
    password: {
      setupTitle: 'Set your password',
      resetTitle: 'Reset your password',
      subtitle: 'Use 12–128 characters.',
      value: 'New password',
      confirm: 'Confirm password',
      submit: 'Save password',
      savedTitle: 'Password saved',
      savedBody: 'Return to Rabbit Interview and sign in.',
    },
    security: {
      title: 'Account security',
      subtitle: 'Manage authenticator MFA and active sessions.',
      account: 'Signed in as',
      enabled: 'Authenticator MFA is enabled.',
      disabled: 'Authenticator MFA is not enabled.',
      start: 'Set up authenticator',
      setupTitle: 'Set up authenticator',
      setupHelp: 'Scan the QR code, then enter the current six-digit code.',
      secret: 'Manual setup key',
      code: 'Verification code',
      confirm: 'Enable MFA',
      recoveryTitle: 'Save your recovery codes',
      recoveryHelp: 'Each code works once. Store them somewhere safe now.',
      password: 'Current password',
      factor: 'Authenticator or recovery code',
      disable: 'Disable MFA',
      revoke: 'Sign out other devices',
      disabledDone: 'Authenticator MFA has been disabled.',
      revokedDone: 'Other devices have been signed out.',
    },
    signedOut: {
      title: 'Signed out',
      body: 'You can close this page or return to Rabbit Interview.',
    },
    subscribe: {
      title: 'Hosted access',
      subtitle: 'Buy fixed hosted-access periods with Alipay, or keep using your own provider keys.',
      hostedTitle: 'Rabbit hosted',
      hostedBody: 'Sign in from the desktop app to use gateway STT and Gemini. Remaining quota is shown below after a browser session exists.',
      byokTitle: 'Bring your own keys',
      byokBody: 'Deepgram, Gemini, Groq, and Apple stay on this device. Hosted quota is not required.',
      grantTitle: 'Fixed periods, no renewal',
      grantBody: 'Each successful payment adds a separate 30- or 90-day quota period. Renewing early schedules the next period after the current one.',
      paymentsNote: 'Alipay purchases are one-time payments. There is no automatic renewal.',
      signedOut: 'Sign in from the desktop app, then reopen this page to see remaining quota.',
      signedIn: 'Signed in as',
      stt: 'STT minutes remaining',
      llm: 'LLM units remaining',
      paymentsOff: 'Payments are disabled.',
      monthPlan: 'Pro monthly',
      quarterPlan: 'Pro quarterly',
      days: 'days',
      sttMinutes: 'STT minutes',
      llmUnits: 'LLM units',
      buy: 'Pay with Alipay',
      redirecting: 'Opening Alipay…',
      currentPlan: 'Plan',
      paidThrough: 'paid through',
      paymentPending: 'Payment is pending. This page will update after Alipay confirms it.',
      paymentPaid: 'Payment verified. The subscription quota is now available.',
      paymentClosed: 'This payment was closed without granting quota.',
    },
    admin: {
      title: 'Grant hosted quota',
      subtitle: 'Look up an account by email, then add STT minutes. Tokens stay in this tab.',
      token: 'Admin token',
      actor: 'Operator',
      email: 'Account email',
      lookup: 'Look up',
      account: 'Account',
      status: 'Status',
      sttMinutes: 'STT minutes to add',
      reason: 'Reason',
      validUntil: 'Valid until (optional)',
      grant: 'Grant quota',
      granted: 'Quota granted.',
    },
    errorTitle: 'Unable to continue',
    errors: sharedErrors.en,
  },
  'zh-CN': {
    htmlLang: 'zh-CN',
    title: 'Rabbit Interview 账号',
    backHome: '返回 Rabbit Interview',
    loading: '加载中…',
    retry: '重试',
    login: {
      title: '登录',
      subtitle: '安全地继续前往 Rabbit Interview 桌面应用。',
      email: '邮箱',
      password: '密码',
      submit: '登录',
      forgot: '忘记密码？',
      register: '创建账号',
      desktopOnlyTitle: '请从桌面应用登录',
      desktopOnlyBody: '此页面只继续桌面应用发起的登录请求。可以先在此注册，再回到应用登录。',
      successTitle: '登录成功',
      successBody: '现在可以返回 Rabbit Interview，此浏览器页面无需继续停留。',
      mfaTitle: '验证登录',
      mfaHelp: '请输入验证器或恢复码。',
      code: '验证码',
      consentTitle: '授权 Rabbit Interview',
      consentHelp: '桌面应用请求以下权限：',
      allow: '允许',
      deny: '拒绝',
    },
    scopes: {
      openid: '确认你的身份',
      profile: '读取显示名称',
      email: '读取邮箱地址',
      offline_access: '在此设备保持登录',
    },
    register: {
      title: '创建账号',
      subtitle: '我们会发送一次性链接，用于验证邮箱并设置密码。',
      name: '显示名称',
      email: '邮箱',
      submit: '创建账号',
      sentTitle: '请查收邮件',
      sentBody: '如果该邮箱可以注册，设置链接已发送。',
      existing: '已有账号？',
      signIn: '去登录',
    },
    forgot: {
      title: '重置密码',
      subtitle: '输入账号邮箱，我们会发送一次性重置链接。',
      email: '邮箱',
      submit: '发送重置链接',
      sentTitle: '请查收邮件',
      sentBody: '如果账号存在，重置链接已发送。',
      backToSignIn: '返回登录',
    },
    password: {
      setupTitle: '设置密码',
      resetTitle: '重置密码',
      subtitle: '请使用 12–128 个字符。',
      value: '新密码',
      confirm: '确认密码',
      submit: '保存密码',
      savedTitle: '密码已保存',
      savedBody: '请返回 Rabbit Interview 并登录。',
    },
    security: {
      title: '账号安全',
      subtitle: '管理验证器 MFA 和活动会话。',
      account: '当前账号',
      enabled: '已启用验证器 MFA。',
      disabled: '尚未启用验证器 MFA。',
      start: '设置验证器',
      setupTitle: '设置验证器',
      setupHelp: '扫描二维码，然后输入当前的六位验证码。',
      secret: '手动设置密钥',
      code: '验证码',
      confirm: '启用 MFA',
      recoveryTitle: '保存恢复码',
      recoveryHelp: '每个恢复码只能使用一次，请立即妥善保存。',
      password: '当前密码',
      factor: '验证器或恢复码',
      disable: '关闭 MFA',
      revoke: '退出其他设备',
      disabledDone: '验证器 MFA 已关闭。',
      revokedDone: '其他设备已退出登录。',
    },
    signedOut: {
      title: '已退出',
      body: '你可以关闭此页面，或返回 Rabbit Interview。',
    },
    subscribe: {
      title: '云托管额度',
      subtitle: '可通过支付宝购买固定期限的云托管服务，也可以继续使用自备密钥。',
      hostedTitle: 'Rabbit 云托管',
      hostedBody: '从桌面应用登录后，可使用网关 STT 和 Gemini。浏览器里若已有登录会话，下方会显示剩余额度。',
      byokTitle: '自备密钥',
      byokBody: 'Deepgram、Gemini、Groq 和 Apple 仍走本机。不需要云托管额度。',
      grantTitle: '固定期限，不自动续费',
      grantBody: '每笔成功支付会增加一个独立的 30 天或 90 天额度周期。提前续费时，新周期会接在当前周期之后。',
      paymentsNote: '支付宝购买为一次性支付，不会自动续费。',
      signedOut: '请先从桌面应用登录，再打开此页查看剩余额度。',
      signedIn: '当前账号',
      stt: '剩余 STT 分钟',
      llm: '剩余 LLM 单位',
      paymentsOff: '支付未启用。',
      monthPlan: 'Pro 月度套餐',
      quarterPlan: 'Pro 季度套餐',
      days: '天',
      sttMinutes: 'STT 分钟',
      llmUnits: 'LLM 单位',
      buy: '使用支付宝支付',
      redirecting: '正在打开支付宝…',
      currentPlan: '套餐',
      paidThrough: '有效期至',
      paymentPending: '支付确认中，支付宝确认后本页会自动更新。',
      paymentPaid: '支付已验证，订阅额度现已生效。',
      paymentClosed: '该笔支付已关闭，未发放额度。',
    },
    admin: {
      title: '发放云托管额度',
      subtitle: '按邮箱查找账号，再增加 STT 分钟。管理令牌只留在当前标签页。',
      token: '管理令牌',
      actor: '操作者',
      email: '账号邮箱',
      lookup: '查找',
      account: '账号',
      status: '状态',
      sttMinutes: '增加的 STT 分钟',
      reason: '原因',
      validUntil: '有效期（可选）',
      grant: '发放额度',
      granted: '额度已发放。',
    },
    errorTitle: '无法继续',
    errors: sharedErrors.zhCN,
  },
  'zh-TW': {
    htmlLang: 'zh-TW',
    title: 'Rabbit Interview 帳號',
    backHome: '返回 Rabbit Interview',
    loading: '載入中…',
    retry: '重試',
    login: {
      title: '登入',
      subtitle: '安全地繼續前往 Rabbit Interview 桌面應用程式。',
      email: '電子郵件',
      password: '密碼',
      submit: '登入',
      forgot: '忘記密碼？',
      register: '建立帳號',
      desktopOnlyTitle: '請從桌面應用程式登入',
      desktopOnlyBody: '此頁面只繼續桌面應用程式發起的登入請求。可以先在此註冊，再回到應用程式登入。',
      successTitle: '登入成功',
      successBody: '現在可以返回 Rabbit Interview，此瀏覽器頁面無需繼續停留。',
      mfaTitle: '驗證登入',
      mfaHelp: '請輸入驗證器或復原碼。',
      code: '驗證碼',
      consentTitle: '授權 Rabbit Interview',
      consentHelp: '桌面應用程式要求以下權限：',
      allow: '允許',
      deny: '拒絕',
    },
    scopes: {
      openid: '確認你的身分',
      profile: '讀取顯示名稱',
      email: '讀取電子郵件地址',
      offline_access: '在此裝置保持登入',
    },
    register: {
      title: '建立帳號',
      subtitle: '我們會傳送一次性連結，用於驗證電子郵件並設定密碼。',
      name: '顯示名稱',
      email: '電子郵件',
      submit: '建立帳號',
      sentTitle: '請查看電子郵件',
      sentBody: '如果此電子郵件可以註冊，設定連結已傳送。',
      existing: '已有帳號？',
      signIn: '去登入',
    },
    forgot: {
      title: '重設密碼',
      subtitle: '輸入帳號電子郵件，我們會傳送一次性重設連結。',
      email: '電子郵件',
      submit: '傳送重設連結',
      sentTitle: '請查看電子郵件',
      sentBody: '如果帳號存在，重設連結已傳送。',
      backToSignIn: '返回登入',
    },
    password: {
      setupTitle: '設定密碼',
      resetTitle: '重設密碼',
      subtitle: '請使用 12–128 個字元。',
      value: '新密碼',
      confirm: '確認密碼',
      submit: '儲存密碼',
      savedTitle: '密碼已儲存',
      savedBody: '請返回 Rabbit Interview 並登入。',
    },
    security: {
      title: '帳號安全',
      subtitle: '管理驗證器 MFA 和使用中的工作階段。',
      account: '目前帳號',
      enabled: '已啟用驗證器 MFA。',
      disabled: '尚未啟用驗證器 MFA。',
      start: '設定驗證器',
      setupTitle: '設定驗證器',
      setupHelp: '掃描 QR 碼，然後輸入目前的六位數驗證碼。',
      secret: '手動設定金鑰',
      code: '驗證碼',
      confirm: '啟用 MFA',
      recoveryTitle: '儲存復原碼',
      recoveryHelp: '每個復原碼只能使用一次，請立即妥善儲存。',
      password: '目前密碼',
      factor: '驗證器或復原碼',
      disable: '停用 MFA',
      revoke: '登出其他裝置',
      disabledDone: '驗證器 MFA 已停用。',
      revokedDone: '其他裝置已登出。',
    },
    signedOut: {
      title: '已登出',
      body: '你可以關閉此頁面，或返回 Rabbit Interview。',
    },
    subscribe: {
      title: '雲端代管額度',
      subtitle: '可透過支付寶購買固定期限的雲端代管服務，也可以繼續使用自備金鑰。',
      hostedTitle: 'Rabbit 雲端代管',
      hostedBody: '從桌面應用程式登入後，可使用閘道 STT 與 Gemini。瀏覽器若已有登入工作階段，下方會顯示剩餘額度。',
      byokTitle: '自備金鑰',
      byokBody: 'Deepgram、Gemini、Groq 與 Apple 仍走本機。不需要雲端代管額度。',
      grantTitle: '固定期限，不自動續費',
      grantBody: '每筆成功付款會增加一個獨立的 30 天或 90 天額度週期。提前續費時，新週期會接在目前週期之後。',
      paymentsNote: '支付寶購買為一次性付款，不會自動續費。',
      signedOut: '請先從桌面應用程式登入，再開啟此頁查看剩餘額度。',
      signedIn: '目前帳號',
      stt: '剩餘 STT 分鐘',
      llm: '剩餘 LLM 單位',
      paymentsOff: '付款未啟用。',
      monthPlan: 'Pro 月度方案',
      quarterPlan: 'Pro 季度方案',
      days: '天',
      sttMinutes: 'STT 分鐘',
      llmUnits: 'LLM 單位',
      buy: '使用支付寶付款',
      redirecting: '正在開啟支付寶…',
      currentPlan: '方案',
      paidThrough: '有效期至',
      paymentPending: '付款確認中，支付寶確認後本頁會自動更新。',
      paymentPaid: '付款已驗證，訂閱額度現已生效。',
      paymentClosed: '此筆付款已關閉，未發放額度。',
    },
    admin: {
      title: '發放雲端代管額度',
      subtitle: '依電子郵件查找帳號，再增加 STT 分鐘。管理權杖只留在目前分頁。',
      token: '管理權杖',
      actor: '操作者',
      email: '帳號電子郵件',
      lookup: '查找',
      account: '帳號',
      status: '狀態',
      sttMinutes: '增加的 STT 分鐘',
      reason: '原因',
      validUntil: '有效期（選填）',
      grant: '發放額度',
      granted: '額度已發放。',
    },
    errorTitle: '無法繼續',
    errors: sharedErrors.zhTW,
  },
}
