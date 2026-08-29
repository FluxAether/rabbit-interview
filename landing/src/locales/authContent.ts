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
  }
  forgot: {
    title: string
    subtitle: string
    email: string
    submit: string
    sentTitle: string
    sentBody: string
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
      existing: 'Already have an account? Open Rabbit Interview to sign in.',
    },
    forgot: {
      title: 'Reset your password',
      subtitle: 'Enter your account email and we will send a one-time reset link.',
      email: 'Email',
      submit: 'Send reset link',
      sentTitle: 'Check your email',
      sentBody: 'If the account exists, a reset link has been sent.',
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
      existing: '已有账号？请打开 Rabbit Interview 登录。',
    },
    forgot: {
      title: '重置密码',
      subtitle: '输入账号邮箱，我们会发送一次性重置链接。',
      email: '邮箱',
      submit: '发送重置链接',
      sentTitle: '请查收邮件',
      sentBody: '如果账号存在，重置链接已发送。',
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
      existing: '已有帳號？請開啟 Rabbit Interview 登入。',
    },
    forgot: {
      title: '重設密碼',
      subtitle: '輸入帳號電子郵件，我們會傳送一次性重設連結。',
      email: '電子郵件',
      submit: '傳送重設連結',
      sentTitle: '請查看電子郵件',
      sentBody: '如果帳號存在，重設連結已傳送。',
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
    errorTitle: '無法繼續',
    errors: sharedErrors.zhTW,
  },
}
