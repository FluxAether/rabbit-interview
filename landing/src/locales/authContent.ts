import type { AuthLang as SharedAuthLang } from './lang'

export type AuthLang = SharedAuthLang

type AuthCopy = {
  htmlLang: string
  title: string
  pageTitles: Record<string, string>
  backHome: string
  homeAria: string
  themeToggle: string
  themeLight: string
  themeDark: string
  loading: string
  retry: string
  openApp: string
  downloadApp: string
  openAppHint: string
  changeEmail: string
  resend: string
  checkSpam: string
  copyCodes: string
  copied: string
  notFoundTitle: string
  notFoundBody: string
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
    noAccount: string
    allow: string
    deny: string
  }
  scopes: Record<string, string>
  register: {
    title: string
    subtitle: string
    name: string
    nameHelp: string
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
    expiredTitle: string
    expiredSetup: string
    expiredReset: string
    requestSetup: string
    requestReset: string
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
    revokeConfirm: string
    disabledDone: string
    revokedDone: string
    cancelSetup: string
  }
  signedOut: {
    title: string
    body: string
  }
  subscribe: {
    title: string
    guestTitle: string
    signedInTitle: string
    subtitle: string
    openToBuy: string
    checkPayment: string
    orderNo: string
    hostedBody: string
    byokTitle: string
    byokBody: string
    grantTitle: string
    grantBody: string
    paymentsNote: string
    signedOut: string
    signedIn: string
    credits: string
    creditLabel: string
    permanent: string
    lifetime: string
    sprint: string
    byokUnlocked: string
    byokLocked: string
    noCredits: string
    availableNow: string
    paymentsOff: string
    buy: string
    redirecting: string
    paymentPending: string
    paymentPaid: string
    paymentClosed: string
  }
  admin: {
    title: string
    subtitle: string
    identityTitle: string
    quotaTitle: string
    grantPreview: string
    token: string
    actor: string
    email: string
    lookup: string
    account: string
    status: string
    credits: string
    reason: string
    validUntil: string
    grant: string
    granted: string
    routingTitle: string
    routingSubtitle: string
    loadRouting: string
    sttRoute: string
    llmRoute: string
    provider: string
    model: string
    activeRoute: string
    routeInvalid: string
    unavailable: string
    updatedBy: string
    activate: string
    routeActivated: string
    routingErrors: Record<string, string>
  }
  errorTitle: string
  errors: Record<string, string>
}

const sharedErrors = {
  en: {
    BYOK_ALREADY_UNLOCKED: "BYOK is already unlocked for this account.",
    MISSING_REQUEST: 'Open sign-in from the OnCue desktop app.',
    REQUEST_EXPIRED: 'This request expired. Start sign-in again from the desktop app.',
    BAD_CREDENTIALS: 'Email or password is incorrect.',
    VERIFICATION_EXPIRED: 'The verification request expired. Sign in again.',
    PASSWORD_REQUIRED: 'Sign in with your password first.',
    ACCOUNT_UNAVAILABLE: 'This account is unavailable.',
    MFA_INCORRECT: 'The authenticator or recovery code is incorrect.',
    AUTHORIZATION_EXPIRED: 'The authorization request expired.',
    AUTH_REQUIRED: 'Sign in through OnCue before opening account security.',
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
    GATEWAY_UNREACHABLE: 'The account service is not connected. Try again.',
    NETWORK_ERROR: 'Unable to reach the account service. Check your connection and try again.',
    ACCOUNT_SUSPENDED: 'This account cannot receive hosted quota.',
    SESSION_NOT_FOUND: 'No account matches that email.',
    IDEMPOTENCY_CONFLICT: 'This checkout request conflicts with an earlier request. Try again.',
    PROVIDER_UNAVAILABLE: 'Alipay is temporarily unavailable. Try again later.',
    PROVIDER_PROTOCOL_ERROR: 'The payment result could not be verified. Refresh this page later.',
  },
  zhCN: {
    BYOK_ALREADY_UNLOCKED: "当前账号已永久解锁 BYOK。",
    MISSING_REQUEST: '请从 OnCue 桌面应用发起登录。',
    REQUEST_EXPIRED: '请求已过期，请从桌面应用重新登录。',
    BAD_CREDENTIALS: '邮箱或密码不正确。',
    VERIFICATION_EXPIRED: '验证请求已过期，请重新登录。',
    PASSWORD_REQUIRED: '请先使用密码登录。',
    ACCOUNT_UNAVAILABLE: '该账号当前不可用。',
    MFA_INCORRECT: '验证器或恢复码不正确。',
    AUTHORIZATION_EXPIRED: '授权请求已过期。',
    AUTH_REQUIRED: '请先通过 OnCue 登录，再打开账号安全页面。',
    INVALID_EMAIL: '请输入有效的邮箱地址。',
    INVALID_DISPLAY_NAME: '请输入不超过 128 个字符的显示名称。',
    INVALID_OR_EXPIRED_LINK: '此链接无效或已过期。',
    PASSWORD_MISMATCH: '两次输入的密码不一致。',
    INVALID_PASSWORD: '密码长度必须为 12-128 个字符。',
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
    GATEWAY_UNREACHABLE: '账号服务未连接，请稍后重试。',
    NETWORK_ERROR: '无法连接账号服务，请检查网络后重试。',
    ACCOUNT_SUSPENDED: '该账号当前不能发放云托管额度。',
    SESSION_NOT_FOUND: '没有匹配该邮箱的账号。',
    IDEMPOTENCY_CONFLICT: '本次支付请求与先前请求冲突，请重试。',
    PROVIDER_UNAVAILABLE: '支付宝暂时不可用，请稍后重试。',
    PROVIDER_PROTOCOL_ERROR: '支付结果暂时无法验证，请稍后刷新本页。',
  },
  zhTW: {
    BYOK_ALREADY_UNLOCKED: "目前帳號已永久解鎖 BYOK。",
    MISSING_REQUEST: '請從 OnCue 桌面應用程式發起登入。',
    REQUEST_EXPIRED: '請求已過期，請從桌面應用程式重新登入。',
    BAD_CREDENTIALS: '電子郵件或密碼不正確。',
    VERIFICATION_EXPIRED: '驗證請求已過期，請重新登入。',
    PASSWORD_REQUIRED: '請先使用密碼登入。',
    ACCOUNT_UNAVAILABLE: '此帳號目前無法使用。',
    MFA_INCORRECT: '驗證器或復原碼不正確。',
    AUTHORIZATION_EXPIRED: '授權請求已過期。',
    AUTH_REQUIRED: '請先透過 OnCue 登入，再開啟帳號安全頁面。',
    INVALID_EMAIL: '請輸入有效的電子郵件地址。',
    INVALID_DISPLAY_NAME: '請輸入不超過 128 個字元的顯示名稱。',
    INVALID_OR_EXPIRED_LINK: '此連結無效或已過期。',
    PASSWORD_MISMATCH: '兩次輸入的密碼不一致。',
    INVALID_PASSWORD: '密碼長度必須為 12-128 個字元。',
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
    GATEWAY_UNREACHABLE: '帳號服務未連線，請稍後再試。',
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
    title: 'OnCue account',
    pageTitles: {
      login: 'Sign in',
      register: 'Create account',
      forgot: 'Reset password',
      setup: 'Set password',
      reset: 'Reset password',
      security: 'Account security',
      subscribe: 'Credits and BYOK',
      admin: 'Administration',
      signedOut: 'Signed out',
      error: 'Account error',
    },
    backHome: 'Back to the site',
    homeAria: 'Back to the OnCue home page',
    themeToggle: 'Toggle theme',
    themeLight: 'Light theme',
    themeDark: 'Dark theme',
    loading: 'Loading…',
    retry: 'Try again',
    openApp: 'Open OnCue',
    downloadApp: 'Download the app',
    openAppHint: 'If nothing happens, open OnCue manually or download it first.',
    changeEmail: 'Use a different email',
    resend: 'Send again',
    checkSpam: 'Check spam or promotions if the email is missing.',
    copyCodes: 'Copy recovery codes',
    copied: 'Copied',
    notFoundTitle: 'Page not found',
    notFoundBody: 'This account link is not valid.',
    login: {
      title: 'Sign in',
      subtitle: 'Continue securely to the OnCue desktop app.',
      email: 'Email',
      password: 'Password',
      submit: 'Sign in',
      forgot: 'Forgot password?',
      register: 'Create an account',
      desktopOnlyTitle: 'Open OnCue to sign in',
      desktopOnlyBody: 'Sign-in can only start from the desktop app. Download it if it is not installed yet.',
      successTitle: 'Sign-in successful',
      successBody: 'Return to OnCue. If the app did not open, launch it from your applications list.',
      mfaTitle: 'Verify sign-in',
      mfaHelp: 'Enter the six-digit authenticator code, or a recovery code.',
      code: 'Authenticator or recovery code',
      consentTitle: 'Authorize OnCue',
      consentHelp: 'The OnCue desktop app is asking for these permissions:',
      noAccount: 'Need an account?',
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
      nameHelp: 'Used in the verification email. You can change it later.',
      email: 'Email',
      submit: 'Send verification email',
      sentTitle: 'Check your email',
      sentBody: 'If this address can be registered, a setup link has been sent. Next: set a password, then sign in from the app.',
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
      subtitle: 'Use 12-128 characters.',
      value: 'New password',
      confirm: 'Confirm password',
      submit: 'Save password',
      savedTitle: 'Password saved',
      savedBody: 'Open OnCue and sign in with the new password.',
      expiredTitle: 'This link is invalid or has expired',
      expiredSetup: 'Request a new setup email to continue.',
      expiredReset: 'Request a new reset email to continue.',
      requestSetup: 'Request a setup email',
      requestReset: 'Request a reset email',
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
      revokeConfirm: 'Other OnCue sessions will be signed out. This browser session stays signed in.',
      disabledDone: 'Authenticator MFA has been disabled.',
      revokedDone: 'Other devices have been signed out.',
      cancelSetup: 'Cancel setup',
    },
    signedOut: {
      title: 'Signed out',
      body: 'You can close this page or return to OnCue.',
    },
    subscribe: {
      title: "Credits and BYOK",
      guestTitle: "Credits or your own keys",
      signedInTitle: "Your credits and access",
      subtitle: "Sign in to use OnCue. Buy shared credits or unlock your own API keys once.",
      openToBuy: "Sign in from OnCue",
      checkPayment: "Check payment",
      orderNo: "Order number",
      hostedBody: "1 minute of speech recognition consumes 3 credits, 1,000 LLM tokens consume 1 credit. Both use the same balance.",
      byokTitle: "Bring your own keys",
      byokBody: "Pay ¥39 once to unlock API keys for this account permanently. Your provider bills usage directly; no credits are used.",
      grantTitle: "300 welcome credits",
      grantBody: "Verify your email and set a password to receive 300 credits once, valid for 30 days. Apple on-device speech requires sign-in but uses no credits and needs no BYOK purchase.",
      paymentsNote: "One-time Alipay payments. Purchased credits never expire and become available immediately after payment is verified.",
      signedOut: "Sign in from the desktop app, then open this page from Settings. New users can register below.",
      signedIn: "Signed in as",
      credits: "Available credits",
      creditLabel: "credits",
      permanent: "Never expires",
      lifetime: "Lifetime unlock",
      sprint: "7-day sprint",
      byokUnlocked: "Unlocked",
      byokLocked: "Not purchased",
      noCredits: "No credits included",
      availableNow: "Added to your balance after payment",
      paymentsOff: "Payments are not enabled.",
      buy: "Pay with Alipay",
      redirecting: "Opening Alipay…",
      paymentPending: "Payment is pending. Check again after completing payment.",
      paymentPaid: "Payment verified. Your credits or BYOK access are now available.",
      paymentClosed: "This payment closed without granting credits or access.",
    },
    admin: {
      title: 'Hosted administration',
      subtitle: 'Manage global AI routing and account credits. Admin credentials stay in this tab.',
      identityTitle: 'Operator credentials',
      quotaTitle: 'Account credits',
      grantPreview: 'Grant {credits} credits to {email}.',
      token: 'Admin token',
      actor: 'Operator',
      email: 'Account email',
      lookup: 'Look up',
      account: 'Account',
      status: 'Status',
      credits: 'Credits to add',
      reason: 'Reason',
      validUntil: 'Valid until (optional)',
      grant: 'Grant credits',
      granted: 'Credits granted.',
      routingTitle: 'Hosted AI routing',
      routingSubtitle: 'Choose the provider and model used by new hosted requests.',
      loadRouting: 'Load AI routing',
      sttRoute: 'Speech-to-text',
      llmRoute: 'Language model',
      provider: 'Provider',
      model: 'Model',
      activeRoute: 'Active',
      routeInvalid: 'configuration unavailable',
      unavailable: 'unavailable',
      updatedBy: 'Last changed by',
      activate: 'Activate',
      routeActivated: 'Hosted AI route activated.',
      routingErrors: {
        AUTH_REQUIRED: 'The admin token or operator is invalid.',
        INVALID_REQUEST: 'Choose a configured provider and allowlisted model.',
        NETWORK_ERROR: 'Unable to reach the gateway. Check your connection and try again.',
        INTERNAL_ERROR: 'Unable to load or update hosted AI routing right now.',
      },
    },
    errorTitle: 'Unable to continue',
    errors: sharedErrors.en,
  },
  'zh-CN': {
    htmlLang: 'zh-CN',
    title: 'OnCue 账号',
    pageTitles: {
      login: '登录',
      register: '注册',
      forgot: '找回密码',
      setup: '设置密码',
      reset: '重置密码',
      security: '账号安全',
      subscribe: '积分与权限',
      admin: '管理',
      signedOut: '已退出',
      error: '账号错误',
    },
    backHome: '返回官网',
    homeAria: '返回 OnCue 首页',
    themeToggle: '切换主题',
    themeLight: '浅色模式',
    themeDark: '深色模式',
    loading: '加载中…',
    retry: '重试',
    openApp: '打开 OnCue',
    downloadApp: '下载应用',
    openAppHint: '如果没有反应，请手动打开应用，或先下载安装。',
    changeEmail: '更换邮箱',
    resend: '重新发送',
    checkSpam: '若未收到邮件，请查看垃圾箱或促销分类。',
    copyCodes: '复制恢复码',
    copied: '已复制',
    notFoundTitle: '页面不存在',
    notFoundBody: '这个账号链接无效。',
    login: {
      title: '登录',
      subtitle: '安全地继续前往 OnCue 桌面应用。',
      email: '邮箱',
      password: '密码',
      submit: '登录',
      forgot: '忘记密码？',
      register: '创建账号',
      desktopOnlyTitle: '打开 OnCue 登录',
      desktopOnlyBody: '登录只能从桌面应用发起。未安装时请先下载。',
      successTitle: '登录成功',
      successBody: '请返回 OnCue。若应用未打开，请从应用列表手动启动。',
      mfaTitle: '验证登录',
      mfaHelp: '请输入验证器六位码，或使用恢复码。',
      code: '验证器或恢复码',
      consentTitle: '授权 OnCue',
      consentHelp: 'OnCue 桌面应用请求以下权限：',
      noAccount: '没有账号？',
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
      nameHelp: '用于验证邮件称呼，可以以后再改。',
      email: '邮箱',
      submit: '发送验证邮件',
      sentTitle: '请查收邮件',
      sentBody: '如果该邮箱可以注册，设置链接已发送。接下来请设置密码，再回到桌面应用登录。',
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
      subtitle: '请使用 12-128 个字符。',
      value: '新密码',
      confirm: '确认密码',
      submit: '保存密码',
      savedTitle: '密码已保存',
      savedBody: '请打开 OnCue，使用新密码登录。',
      expiredTitle: '链接无效或已过期',
      expiredSetup: '请重新申请设置邮件。',
      expiredReset: '请重新申请重置邮件。',
      requestSetup: '重新申请设置邮件',
      requestReset: '重新申请重置邮件',
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
      revokeConfirm: '其他已登录的 OnCue 会退出，当前浏览器会话保留。',
      disabledDone: '验证器 MFA 已关闭。',
      revokedDone: '其他设备已退出登录。',
      cancelSetup: '取消设置',
    },
    signedOut: {
      title: '已退出',
      body: '你可以关闭此页面，或返回 OnCue。',
    },
    subscribe: {
      title: "积分与自备密钥",
      guestTitle: "购买积分或解锁自备密钥",
      signedInTitle: "我的积分与权限",
      subtitle: "使用 OnCue 需要登录。可充值共享积分，或一次购买解锁自备 API Key。",
      openToBuy: "从 OnCue 登录",
      checkPayment: "查询支付结果",
      orderNo: "订单号",
      hostedBody: "1 分钟语音识别消耗 3 积分，1,000 个 LLM token 消耗 1 积分。语音和回答共用同一余额。",
      byokTitle: "自备密钥",
      byokBody: "¥39 一次购买，为当前账号永久解锁 API Key。用量由供应商直接计费，不消耗积分。",
      grantTitle: "新用户赠送 300 积分",
      grantBody: "完成邮箱验证并设置密码后，一次性赠送 300 积分，有效期 30 天。Apple 本地语音识别只需登录，不消耗积分，也无需购买 BYOK。",
      paymentsNote: "支付宝一次性支付。购买的积分永久有效，支付验证成功后立即到账。",
      signedOut: "请先从桌面应用登录，再从设置打开此页。新用户可在下方注册。",
      signedIn: "当前账号",
      credits: "可用积分",
      creditLabel: "积分",
      permanent: "永久有效",
      lifetime: "永久解锁",
      sprint: "7天冲刺",
      byokUnlocked: "已解锁",
      byokLocked: "未购买",
      noCredits: "不含积分",
      availableNow: "支付成功后立即到账",
      paymentsOff: "支付未启用。",
      buy: "使用支付宝支付",
      redirecting: "正在打开支付宝…",
      paymentPending: "支付待确认，完成支付后可再次查询。",
      paymentPaid: "支付已验证，积分或 BYOK 权限已生效。",
      paymentClosed: "该笔支付已关闭，未发放积分或权限。",
    },
    admin: {
      title: '云托管管理',
      subtitle: '管理全局 AI 路由和账号积分。管理凭据只留在当前标签页。',
      identityTitle: '管理身份',
      quotaTitle: '用户积分',
      grantPreview: '向 {email} 发放 {credits} 积分。',
      token: '管理令牌',
      actor: '操作者',
      email: '账号邮箱',
      lookup: '查找',
      account: '账号',
      status: '状态',
      credits: '增加的积分',
      reason: '原因',
      validUntil: '有效期（可选）',
      grant: '发放积分',
      granted: '积分已发放。',
      routingTitle: '云托管 AI 路由',
      routingSubtitle: '选择新建云托管请求使用的渠道和模型。',
      loadRouting: '加载 AI 路由',
      sttRoute: '语音转文字',
      llmRoute: '语言模型',
      provider: '渠道',
      model: '模型',
      activeRoute: '当前使用',
      routeInvalid: '配置不可用',
      unavailable: '不可用',
      updatedBy: '最后修改人',
      activate: '启用',
      routeActivated: '云托管 AI 路由已启用。',
      routingErrors: {
        AUTH_REQUIRED: '管理令牌或操作者无效。',
        INVALID_REQUEST: '请选择已配置的渠道和允许使用的模型。',
        NETWORK_ERROR: '无法连接网关，请检查网络后重试。',
        INTERNAL_ERROR: '暂时无法加载或更新云托管 AI 路由。',
      },
    },
    errorTitle: '无法继续',
    errors: sharedErrors.zhCN,
  },
  'zh-TW': {
    htmlLang: 'zh-TW',
    title: 'OnCue 帳號',
    pageTitles: {
      login: '登入',
      register: '註冊',
      forgot: '重設密碼',
      setup: '設定密碼',
      reset: '重設密碼',
      security: '帳號安全',
      subscribe: '積分與權限',
      admin: '管理',
      signedOut: '已登出',
      error: '帳號錯誤',
    },
    backHome: '返回官網',
    homeAria: '返回 OnCue 首頁',
    themeToggle: '切換主題',
    themeLight: '淺色模式',
    themeDark: '深色模式',
    loading: '載入中…',
    retry: '重試',
    openApp: '打開 OnCue',
    downloadApp: '下載應用程式',
    openAppHint: '如果沒有反應，請手動打開應用程式，或先下載安裝。',
    changeEmail: '更換電子郵件',
    resend: '重新傳送',
    checkSpam: '若未收到郵件，請查看垃圾郵件或促銷分類。',
    copyCodes: '複製復原碼',
    copied: '已複製',
    notFoundTitle: '頁面不存在',
    notFoundBody: '這個帳號連結無效。',
    login: {
      title: '登入',
      subtitle: '安全地繼續前往 OnCue 桌面應用程式。',
      email: '電子郵件',
      password: '密碼',
      submit: '登入',
      forgot: '忘記密碼？',
      register: '建立帳號',
      desktopOnlyTitle: '打開 OnCue 登入',
      desktopOnlyBody: '登入只能從桌面應用程式發起。尚未安裝時請先下載。',
      successTitle: '登入成功',
      successBody: '請返回 OnCue。若應用程式未打開，請從應用程式列表手動啟動。',
      mfaTitle: '驗證登入',
      mfaHelp: '請輸入驗證器六位數，或使用復原碼。',
      code: '驗證器或復原碼',
      consentTitle: '授權 OnCue',
      consentHelp: 'OnCue 桌面應用程式要求以下權限：',
      noAccount: '沒有帳號？',
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
      nameHelp: '用於驗證郵件稱呼，可以稍後再改。',
      email: '電子郵件',
      submit: '傳送驗證郵件',
      sentTitle: '請查看電子郵件',
      sentBody: '如果此電子郵件可以註冊，設定連結已傳送。接下來請設定密碼，再回到桌面應用程式登入。',
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
      subtitle: '請使用 12-128 個字元。',
      value: '新密碼',
      confirm: '確認密碼',
      submit: '儲存密碼',
      savedTitle: '密碼已儲存',
      savedBody: '請打開 OnCue，使用新密碼登入。',
      expiredTitle: '連結無效或已過期',
      expiredSetup: '請重新申請設定郵件。',
      expiredReset: '請重新申請重設郵件。',
      requestSetup: '重新申請設定郵件',
      requestReset: '重新申請重設郵件',
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
      revokeConfirm: '其他已登入的 OnCue 會登出，目前瀏覽器工作階段會保留。',
      disabledDone: '驗證器 MFA 已停用。',
      revokedDone: '其他裝置已登出。',
      cancelSetup: '取消設定',
    },
    signedOut: {
      title: '已登出',
      body: '你可以關閉此頁面，或返回 OnCue。',
    },
    subscribe: {
      title: "積分與自備金鑰",
      guestTitle: "購買積分或解鎖自備金鑰",
      signedInTitle: "我的積分與權限",
      subtitle: "使用 OnCue 需要登入。可儲值共享積分，或一次購買解鎖自備 API Key。",
      openToBuy: "從 OnCue 登入",
      checkPayment: "查詢付款結果",
      orderNo: "訂單編號",
      hostedBody: "1 分鐘語音辨識消耗 3 積分，1,000 個 LLM token 消耗 1 積分。語音與回答共用同一餘額。",
      byokTitle: "自備金鑰",
      byokBody: "¥39 一次購買，為目前帳號永久解鎖 API Key。用量由供應商直接計費，不消耗積分。",
      grantTitle: "新用戶贈送 300 積分",
      grantBody: "完成電子郵件驗證並設定密碼後，一次贈送 300 積分，有效期 30 天。Apple 本機語音辨識只需登入，不消耗積分，也無需購買 BYOK。",
      paymentsNote: "支付寶一次付款。購買的積分永久有效，付款驗證成功後立即到帳。",
      signedOut: "請先從桌面應用程式登入，再從設定開啟此頁。新用戶可在下方註冊。",
      signedIn: "目前帳號",
      credits: "可用積分",
      creditLabel: "積分",
      permanent: "永久有效",
      lifetime: "永久解鎖",
      sprint: "7天衝刺",
      byokUnlocked: "已解鎖",
      byokLocked: "未購買",
      noCredits: "不含積分",
      availableNow: "付款成功後立即到帳",
      paymentsOff: "付款未啟用。",
      buy: "使用支付寶付款",
      redirecting: "正在開啟支付寶…",
      paymentPending: "付款待確認，完成付款後可再次查詢。",
      paymentPaid: "付款已驗證，積分或 BYOK 權限已生效。",
      paymentClosed: "此筆付款已關閉，未發放積分或權限。",
    },
    admin: {
      title: '雲端代管管理',
      subtitle: '管理全域 AI 路由和帳號積分。管理憑據只留在目前分頁。',
      identityTitle: '管理身分',
      quotaTitle: '使用者積分',
      grantPreview: '向 {email} 發放 {credits} 積分。',
      token: '管理權杖',
      actor: '操作者',
      email: '帳號電子郵件',
      lookup: '查找',
      account: '帳號',
      status: '狀態',
      credits: '增加的積分',
      reason: '原因',
      validUntil: '有效期（選填）',
      grant: '發放積分',
      granted: '積分已發放。',
      routingTitle: '雲端代管 AI 路由',
      routingSubtitle: '選擇新建雲端代管請求使用的渠道和模型。',
      loadRouting: '載入 AI 路由',
      sttRoute: '語音轉文字',
      llmRoute: '語言模型',
      provider: '渠道',
      model: '模型',
      activeRoute: '目前使用',
      routeInvalid: '設定不可用',
      unavailable: '不可用',
      updatedBy: '最後修改人',
      activate: '啟用',
      routeActivated: '雲端代管 AI 路由已啟用。',
      routingErrors: {
        AUTH_REQUIRED: '管理權杖或操作者無效。',
        INVALID_REQUEST: '請選擇已設定的渠道和允許使用的模型。',
        NETWORK_ERROR: '無法連線閘道，請檢查網路後再試。',
        INTERNAL_ERROR: '暫時無法載入或更新雲端代管 AI 路由。',
      },
    },
    errorTitle: '無法繼續',
    errors: sharedErrors.zhTW,
  },
}
