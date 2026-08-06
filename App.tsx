import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  ImageBackground,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api, resolveApiUrl, setAuthToken, setUnauthorizedHandler, uploadFile } from './src/api/client';
import { subscribeAvailability } from './src/api/realtime';
import { AdminUser, AuthResponse, CalendarSlot, ClientDashboard, Court, CourtStats, OperationsDashboard, OperationsReservation, PasswordResetResponse, PaymentConfig, RegistrationResponse, Reservation, ReservationAudit, ReservationQuote, Role } from './src/types';
import { clearSession, getSession, getTokenExpirationMs, saveSession } from './src/storage/session';

const APP_TIME_ZONE = 'America/Lima';

function getAppDateIso(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(value);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

const todayIso = getAppDateIso();
const SESSION_LOAD_TIMEOUT_MS = 2_500;
const heroImage = 'https://images.unsplash.com/photo-1556056504-5c7696c4c28d?auto=format&fit=crop&w=1200&q=80';
const courtImages = [
  'https://images.unsplash.com/photo-1624880357913-a8539238245b?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1606925797300-0b35e9d1794e?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1522778119026-d647f0596c20?auto=format&fit=crop&w=900&q=80'
];

type AuthMode = 'welcome' | 'login' | 'register' | 'verify' | 'forgot' | 'reset';
type AuthField = 'names' | 'lastNames' | 'email' | 'phone' | 'password' | 'confirmPassword';
type AuthFieldErrors = Partial<Record<AuthField, string>>;
type HomeTab = 'home' | 'reservations' | 'courts' | 'admin' | 'profile';

type ReservationDraft = {
  court: Court;
  reservation: Reservation;
  date: string;
  displayDate: string;
  startTime: string;
  endTime: string;
};

export default function App() {
  const [session, setSession] = useState<AuthResponse | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);

  useEffect(() => {
    setUnauthorizedHandler(async () => {
      setAuthToken(null);
      setSession(null);
      await clearSession();
    });

    Promise.race<AuthResponse | null>([
      getSession(),
      new Promise((resolve) => setTimeout(() => resolve(null), SESSION_LOAD_TIMEOUT_MS))
    ])
      .then((stored) => {
        if (stored) {
          setAuthToken(stored.token);
          setSession(stored);
        }
      })
      .catch(() => undefined)
      .finally(() => setLoadingSession(false));

    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    if (!session) return;
    const expiration = getTokenExpirationMs(session.token);
    if (expiration === null) return;
    const expireSession = () => {
      setAuthToken(null);
      setSession(null);
      void clearSession();
    };
    const remainingMs = expiration - Date.now();
    if (remainingMs <= 0) {
      expireSession();
      return;
    }
    const timeout = setTimeout(expireSession, remainingMs);
    return () => clearTimeout(timeout);
  }, [session]);

  const onAuth = async (auth: AuthResponse, shouldRemember: boolean) => {
    setAuthToken(auth.token);
    setSession(auth);
    if (shouldRemember) {
      await saveSession(auth);
    } else {
      await clearSession();
    }
  };

  const logout = async () => {
    setAuthToken(null);
    setSession(null);
    await clearSession();
  };

  return (
    <SafeAreaProvider>
      {loadingSession ? (
        <Centered text="Cargando sesión..." />
      ) : (
        <SafeAreaView style={styles.safe}>
          <StatusBar style="light" />
          {session ? <HomeScreen session={session} onLogout={logout} /> : <AuthScreen onAuth={onAuth} />}
        </SafeAreaView>
      )}
    </SafeAreaProvider>
  );
}

function AuthScreen({ onAuth }: { onAuth: (auth: AuthResponse, shouldRemember: boolean) => Promise<void> }) {
  const [mode, setMode] = useState<AuthMode>('welcome');
  const [names, setNames] = useState('');
  const [lastNames, setLastNames] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationError, setVerificationError] = useState<string>();
  const [resendRemaining, setResendRemaining] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({});
  const [resetCode, setResetCode] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState('');
  const [resetError, setResetError] = useState<string>();
  const [resetResendRemaining, setResetResendRemaining] = useState(0);

  const updateAuthField = (field: AuthField, setter: (value: string) => void, value: string) => {
    setter(value);
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  };

  const validateAuthField = (field: AuthField) => {
    let error: string | undefined;
    if (field === 'email') {
      const value = email.trim();
      error = !value ? 'El correo electrónico es obligatorio.'
        : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? 'Ingresa un correo válido, por ejemplo nombre@correo.com.' : undefined;
    } else if (field === 'phone') {
      error = !/^9\d{8}$/.test(phone) ? 'Debe tener 9 dígitos y comenzar con 9.' : undefined;
    } else if (field === 'password') {
      error = !password ? 'La contraseña es obligatoria.'
        : !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,80}$/.test(password) ? 'Usa 8 caracteres como mínimo, mayúscula, minúscula y número.' : undefined;
    } else if (field === 'confirmPassword') {
      error = !confirmPassword ? 'Confirma tu contraseña.'
        : password !== confirmPassword ? 'Las contraseñas no coinciden.' : undefined;
    } else {
      const value = field === 'names' ? names.trim() : lastNames.trim();
      const label = field === 'names' ? 'nombres' : 'apellidos';
      const personNamePattern = /^[\p{L}]+(?:[ '\-][\p{L}]+)*$/u;
      error = value.length < 2 ? `Ingresa tus ${label}.`
        : !personNamePattern.test(value) ? 'Usa solo letras, espacios, apóstrofes o guiones.' : undefined;
    }
    setFieldErrors((current) => ({ ...current, [field]: error }));
  };

  const navigateAuth = (nextMode: AuthMode) => {
    setPassword('');
    setConfirmPassword('');
    setFieldErrors({});
    setMode(nextMode);
  };

  useEffect(() => {
    if (mode !== 'verify' || resendRemaining <= 0) return;
    const timer = setInterval(() => setResendRemaining((current) => Math.max(0, current - 1)), 1000);
    return () => clearInterval(timer);
  }, [mode, resendRemaining > 0]);

  useEffect(() => {
    if (mode !== 'reset' || resetResendRemaining <= 0) return;
    const timer = setInterval(() => setResetResendRemaining((current) => Math.max(0, current - 1)), 1000);
    return () => clearInterval(timer);
  }, [mode, resetResendRemaining > 0]);

  const submit = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    const errors: AuthFieldErrors = {};
    if (!normalizedEmail) {
      errors.email = 'El correo electrónico es obligatorio.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      errors.email = 'Ingresa un correo válido, por ejemplo nombre@correo.com.';
    }
    if (!password) errors.password = 'La contraseña es obligatoria.';
    if (mode === 'register') {
      const personNamePattern = /^[\p{L}]+(?:[ '\-][\p{L}]+)*$/u;
      if (names.trim().length < 2) {
        errors.names = 'Ingresa tus nombres.';
      } else if (!personNamePattern.test(names.trim())) {
        errors.names = 'Usa solo letras, espacios, apóstrofes o guiones.';
      }
      if (lastNames.trim().length < 2) {
        errors.lastNames = 'Ingresa tus apellidos.';
      } else if (!personNamePattern.test(lastNames.trim())) {
        errors.lastNames = 'Usa solo letras, espacios, apóstrofes o guiones.';
      }
      if (!/^9\d{8}$/.test(phone)) errors.phone = 'Debe tener 9 dígitos y comenzar con 9.';
      if (password && !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,80}$/.test(password)) {
        errors.password = 'Usa 8 caracteres como mínimo, mayúscula, minúscula y número.';
      }
      if (!confirmPassword) {
        errors.confirmPassword = 'Confirma tu contraseña.';
      } else if (password !== confirmPassword) {
        errors.confirmPassword = 'Las contraseñas no coinciden.';
      }
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      Alert.alert('Revisa tus datos', 'Corrige los campos marcados para continuar.');
      return;
    }

    try {
      setBusy(true);
      if (mode === 'login') {
        const payload = await api<AuthResponse>('/auth/login', {
          method: 'POST',
          body: { email: normalizedEmail, password }
        });
        await onAuth(payload, remember);
      } else {
        const payload = await api<RegistrationResponse>('/auth/register', {
          method: 'POST',
          body: { fullName: `${names.trim()} ${lastNames.trim()}`, email: normalizedEmail, password, phone }
        });
        setVerificationEmail(payload.email);
        setVerificationCode('');
        setVerificationError(undefined);
        setResendRemaining(payload.resendAfterSeconds);
        setMode('verify');
      }
    } catch (error) {
      Alert.alert('No se pudo ingresar', error instanceof Error ? error.message : 'Error desconocido');
    } finally {
      setBusy(false);
    }
  };

  const verifyEmail = async () => {
    if (verificationCode.length !== 6) {
      setVerificationError('Ingresa los 6 dígitos enviados a tu correo.');
      return;
    }
    try {
      setBusy(true);
      const auth = await api<AuthResponse>('/auth/verify-email', {
        method: 'POST',
        body: { email: verificationEmail, code: verificationCode }
      });
      await onAuth(auth, true);
    } catch (error) {
      setVerificationError(error instanceof Error ? error.message : 'No se pudo verificar el código.');
    } finally {
      setBusy(false);
    }
  };

  const resendVerification = async () => {
    if (resendRemaining > 0) return;
    try {
      setBusy(true);
      const payload = await api<RegistrationResponse>('/auth/resend-verification', {
        method: 'POST',
        body: { email: verificationEmail }
      });
      setVerificationCode('');
      setVerificationError(undefined);
      setResendRemaining(payload.resendAfterSeconds);
      Alert.alert('Código enviado', payload.message);
    } catch (error) {
      Alert.alert('No se pudo reenviar', error instanceof Error ? error.message : 'Error desconocido');
    } finally {
      setBusy(false);
    }
  };

  const requestPasswordReset = async (isResend = false) => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setFieldErrors((current) => ({ ...current, email: 'Ingresa un correo válido.' }));
      return;
    }
    try {
      setBusy(true);
      const payload = await api<PasswordResetResponse>('/auth/forgot-password', {
        method: 'POST',
        body: { email: normalizedEmail }
      });
      setResetResendRemaining(payload.resendAfterSeconds);
      setResetError(undefined);
      if (!isResend) {
        setResetCode('');
        setResetPassword('');
        setResetPasswordConfirm('');
        setMode('reset');
      } else {
        Alert.alert('Solicitud enviada', payload.message);
      }
    } catch (error) {
      Alert.alert('No se pudo enviar', error instanceof Error ? error.message : 'Error desconocido');
    } finally {
      setBusy(false);
    }
  };

  const resetForgottenPassword = async () => {
    if (resetCode.length !== 6) {
      setResetError('Ingresa el código de 6 dígitos.');
      return;
    }
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,80}$/.test(resetPassword)) {
      setResetError('La nueva contraseña necesita 8 caracteres, mayúscula, minúscula y número.');
      return;
    }
    if (resetPassword !== resetPasswordConfirm) {
      setResetError('Las contraseñas no coinciden.');
      return;
    }
    try {
      setBusy(true);
      const payload = await api<PasswordResetResponse>('/auth/reset-password', {
        method: 'POST',
        body: { email: email.trim().toLowerCase(), code: resetCode, newPassword: resetPassword }
      });
      Alert.alert('Contraseña actualizada', payload.message);
      setResetCode('');
      setResetPassword('');
      setResetPasswordConfirm('');
      navigateAuth('login');
    } catch (error) {
      setResetError(error instanceof Error ? error.message : 'No se pudo cambiar la contraseña.');
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'verify') {
    return (
      <AuthShell onBack={() => navigateAuth('register')}>
        <View style={styles.forgotIcon}>
          <Ionicons name="shield-checkmark" size={44} color="#ffffff" />
        </View>
        <Text style={styles.authTitle}>Verifica tu <Text style={styles.greenText}>correo</Text></Text>
        <Text style={styles.centerCopy}>
          Enviamos un código de 6 dígitos a {verificationEmail}. El código vence en 10 minutos.
        </Text>
        <Field
          icon="keypad-outline"
          label="Código de verificación"
          placeholder="000000"
          value={verificationCode}
          onChangeText={(value) => {
            setVerificationCode(value.replace(/\D/g, '').slice(0, 6));
            setVerificationError(undefined);
          }}
          keyboardType="number-pad"
          maxLength={6}
          error={verificationError}
        />
        <Button
          title={busy ? 'Verificando...' : 'Verificar y continuar'}
          onPress={verifyEmail}
          disabled={busy || verificationCode.length !== 6}
        />
        <Pressable onPress={resendVerification} disabled={busy || resendRemaining > 0}>
          <Text style={[styles.mutedCenter, resendRemaining === 0 && styles.greenLink]}>
            {resendRemaining > 0 ? `Reenviar código en ${resendRemaining}s` : 'Reenviar código'}
          </Text>
        </Pressable>
        <Pressable onPress={() => navigateAuth('register')}>
          <Text style={styles.mutedCenter}>Corregir mis datos</Text>
        </Pressable>
      </AuthShell>
    );
  }

  if (mode === 'welcome') {
    return (
      <ImageBackground source={{ uri: heroImage }} style={styles.welcome} imageStyle={styles.fillImage}>
        <View style={styles.scrim} />
        <View style={styles.brandMark}>
          <Ionicons name="football" size={58} color="#f7fff5" />
        </View>
        <Text style={styles.logoText}>RESER<Text style={styles.greenText}>GRASS</Text></Text>
        <Text style={styles.welcomeCopy}>Reserva tu cancha, disfruta el juego</Text>
        <View style={styles.welcomeActions}>
          <Button title="Iniciar sesión" onPress={() => navigateAuth('login')} />
          <Button title="Crear cuenta" variant="outline" onPress={() => navigateAuth('register')} />
        </View>
      </ImageBackground>
    );
  }

  if (mode === 'reset') {
    return (
      <AuthShell onBack={() => navigateAuth('forgot')}>
        <View style={styles.forgotIcon}>
          <Ionicons name="key" size={44} color="#ffffff" />
        </View>
        <Text style={styles.authTitle}>Crea una <Text style={styles.greenText}>nueva contraseña</Text></Text>
        <Text style={styles.centerCopy}>Ingresa el código enviado a {email.trim().toLowerCase()} y tu nueva contraseña.</Text>
        <Field icon="keypad-outline" label="Código de 6 dígitos" placeholder="000000" value={resetCode} onChangeText={(value) => { setResetCode(value.replace(/\D/g, '').slice(0, 6)); setResetError(undefined); }} keyboardType="number-pad" maxLength={6} />
        <Field icon="lock-closed" label="Nueva contraseña" placeholder="••••••••" value={resetPassword} onChangeText={(value) => { setResetPassword(value); setResetError(undefined); }} secureTextEntry />
        <Text style={styles.authFieldHint}>Mínimo 8 caracteres, con mayúscula, minúscula y número.</Text>
        <Field icon="lock-closed-outline" label="Confirmar nueva contraseña" placeholder="••••••••" value={resetPasswordConfirm} onChangeText={(value) => { setResetPasswordConfirm(value); setResetError(undefined); }} secureTextEntry />
        {resetError && <Text style={styles.fieldErrorText}>{resetError}</Text>}
        <Button title={busy ? 'Actualizando...' : 'Cambiar contraseña'} onPress={resetForgottenPassword} disabled={busy} />
        <Pressable onPress={() => requestPasswordReset(true)} disabled={busy || resetResendRemaining > 0}>
          <Text style={[styles.mutedCenter, resetResendRemaining === 0 && styles.greenLink]}>
            {resetResendRemaining > 0 ? `Reenviar código en ${resetResendRemaining}s` : 'Reenviar código'}
          </Text>
        </Pressable>
      </AuthShell>
    );
  }

  if (mode === 'forgot') {
    return (
      <AuthShell onBack={() => navigateAuth('login')}>
        <View style={styles.forgotIcon}>
          <Ionicons name="mail" size={44} color="#ffffff" />
        </View>
        <Text style={styles.authTitle}>Recuperar <Text style={styles.greenText}>contraseña</Text></Text>
        <Text style={styles.centerCopy}>Ingresa tu correo electrónico y te enviaremos un código de 6 dígitos.</Text>
        <Field icon="mail-outline" label="Correo electrónico" placeholder="ejemplo@correo.com" value={email} onChangeText={(value) => updateAuthField('email', setEmail, value)} onBlur={() => validateAuthField('email')} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" error={fieldErrors.email} />
        <Button title={busy ? 'Enviando...' : 'Enviar código'} onPress={() => requestPasswordReset()} disabled={busy} />
        <Pressable onPress={() => navigateAuth('login')}>
          <Text style={styles.mutedCenter}>Volver al inicio de sesión</Text>
        </Pressable>
      </AuthShell>
    );
  }

  return (
    <AuthShell onBack={() => navigateAuth('welcome')}>
      <Text style={styles.authTitle}>{mode === 'login' ? 'Bienvenido' : 'Crear cuenta'}</Text>
      <Text style={styles.authSub}>{mode === 'login' ? 'Inicia sesión para continuar' : 'Únete a ReserGrass'}</Text>

      {mode === 'register' && (
        <>
          <Field icon="person" label="Nombres" placeholder="Ej. Carlos Alberto" value={names} onChangeText={(value) => updateAuthField('names', setNames, value)} onBlur={() => validateAuthField('names')} error={fieldErrors.names} />
          <Field icon="people-outline" label="Apellidos" placeholder="Ej. Pérez Gómez" value={lastNames} onChangeText={(value) => updateAuthField('lastNames', setLastNames, value)} onBlur={() => validateAuthField('lastNames')} error={fieldErrors.lastNames} />
        </>
      )}
      <Field icon="mail-outline" label="Correo electrónico" placeholder="ejemplo@correo.com" value={email} onChangeText={(value) => updateAuthField('email', setEmail, value)} onBlur={() => validateAuthField('email')} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" error={fieldErrors.email} />
      {mode === 'register' && <Field icon="phone-portrait-outline" label="Celular" placeholder="987654321" value={phone} onChangeText={(value) => updateAuthField('phone', setPhone, toNineDigits(value))} onBlur={() => validateAuthField('phone')} keyboardType="number-pad" maxLength={9} error={fieldErrors.phone} />}
      <Field icon="lock-closed" label="Contraseña" placeholder="••••••••••" value={password} onChangeText={(value) => updateAuthField('password', setPassword, value)} onBlur={() => validateAuthField('password')} secureTextEntry error={fieldErrors.password} />
      {mode === 'register' && !fieldErrors.password && (
        <Text style={styles.authFieldHint}>Mínimo 8 caracteres, con mayúscula, minúscula y número.</Text>
      )}
      {mode === 'register' && <Field icon="lock-closed-outline" label="Confirmar contraseña" placeholder="••••••••••" value={confirmPassword} onChangeText={(value) => updateAuthField('confirmPassword', setConfirmPassword, value)} onBlur={() => validateAuthField('confirmPassword')} secureTextEntry error={fieldErrors.confirmPassword} />}

      {mode === 'login' && (
        <View style={styles.loginOptions}>
          <Pressable style={styles.remember} onPress={() => setRemember(!remember)}>
            <Ionicons name={remember ? 'checkbox' : 'square-outline'} size={20} color="#59c13a" />
            <Text style={styles.muted}>Recordarme</Text>
          </Pressable>
          <Pressable onPress={() => navigateAuth('forgot')}>
            <Text style={styles.greenLink}>¿Olvidaste tu contraseña?</Text>
          </Pressable>
        </View>
      )}

      <Button title={busy ? 'Procesando...' : mode === 'login' ? 'Iniciar sesión' : 'Crear mi cuenta'} onPress={submit} disabled={busy} />


      <Pressable onPress={() => navigateAuth(mode === 'login' ? 'register' : 'login')}>
        <Text style={styles.mutedCenter}>
          {mode === 'login' ? '¿No tienes cuenta? ' : '¿Ya tienes cuenta? '}
          <Text style={styles.greenLink}>{mode === 'login' ? 'Crear cuenta' : 'Iniciar sesión'}</Text>
        </Text>
      </Pressable>
    </AuthShell>
  );
}

function AuthShell({ children, onBack }: { children: React.ReactNode; onBack: () => void }) {
  return (
    <ScrollView contentContainerStyle={styles.authScreen}>
      <Pressable style={styles.backButton} onPress={onBack}>
        <Ionicons name="arrow-back" size={24} color="#ffffff" />
      </Pressable>
      {children}
    </ScrollView>
  );
}

function HomeScreen({ session, onLogout }: { session: AuthResponse; onLogout: () => void }) {
  const [tab, setTab] = useState<HomeTab>('home');
  const [screen, setScreen] = useState<'tabs' | 'court' | 'success'>('tabs');
  const [courts, setCourts] = useState<Court[]>([]);
  const [selectedCourt, setSelectedCourt] = useState<Court | null>(null);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [draft, setDraft] = useState<ReservationDraft | null>(null);

  const canManage = useMemo(() => session.role === 'PERSONAL' || session.role === 'ADMIN', [session.role]);

  useEffect(() => {
    loadCourts();
  }, []);

  const loadCourts = async () => {
    try {
      const data = await api<Court[]>('/courts');
      setCourts(data);
      if (data[0]) {
        await loadReservations(data[0].id);
      }
    } catch (error) {
      Alert.alert('Canchas', error instanceof Error ? error.message : 'No se pudieron cargar las canchas');
    }
  };

  const loadReservations = async (courtId = courts[0]?.id) => {
    if (canManage && !courtId) return;
    try {
      const path = canManage
        ? `/reservations?courtId=${courtId}&date=${todayIso}`
        : '/reservations/mine';
      const data = await api<Reservation[]>(path);
      setReservations(data);
    } catch {
      setReservations([]);
    }
  };

  const openCourt = (court: Court) => {
    setSelectedCourt(court);
    setScreen('court');
  };

  if (screen === 'court' && selectedCourt) {
    return (
      <CourtDetailScreen
        court={selectedCourt}
        session={session}
        onBack={() => setScreen('tabs')}
        onReserved={(createdDraft) => {
          setDraft(createdDraft);
          setScreen('success');
          loadReservations();
        }}
      />
    );
  }

  if (screen === 'success' && draft) {
    return <SuccessScreen draft={draft} onHome={() => setScreen('tabs')} onReservations={() => { setTab('reservations'); setScreen('tabs'); }} />;
  }

  return (
    <View style={styles.appShell}>
      {tab === 'home' && (canManage
        ? <ManagedDashboard session={session} courts={courts} openCourt={openCourt} openReservations={() => setTab('reservations')} openCourts={() => setTab('courts')} />
        : <Dashboard session={session} courts={courts} openCourt={openCourt} openReservations={() => setTab('reservations')} openCourts={() => setTab('courts')} />)}
      {tab === 'reservations' && <ReservationsScreen reservations={reservations} courts={courts} canManage={canManage} refreshParent={loadReservations} />}
      {tab === 'courts' && <CourtsScreen courts={courts} openCourt={openCourt} />}
      {tab === 'admin' && <AdminCourtsScreen courts={courts} refresh={loadCourts} />}
      {tab === 'profile' && <ProfileScreen session={session} onLogout={onLogout} />}
      <BottomTabs active={tab} onChange={setTab} role={session.role} />
    </View>
  );
}

function Dashboard({
  session, courts, openCourt, openReservations, openCourts
}: {
  session: AuthResponse; courts: Court[]; openCourt: (court: Court) => void;
  openReservations: () => void; openCourts: () => void;
}) {
  const [dashboard, setDashboard] = useState<ClientDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadDashboard = async () => {
    try {
      setLoading(true);
      setError('');
      setDashboard(await api<ClientDashboard>('/dashboard/client'));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo cargar el inicio.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadDashboard(); }, []);

  if (loading && !dashboard) {
    return <View style={styles.managedLoading}><ActivityIndicator color="#58c83c" size="large" /><Text style={styles.bodyCopy}>Buscando horarios disponibles...</Text></View>;
  }
  if (!dashboard) {
    return <View style={styles.managedLoading}><Ionicons name="cloud-offline-outline" size={46} color="#e46b62" /><Text style={styles.managedError}>{error}</Text><Pressable style={styles.primaryAction} onPress={loadDashboard}><Text style={styles.activeText}>Reintentar</Text></Pressable></View>;
  }

  const nextReservation = dashboard.nextReservation;
  return (
    <ScrollView contentContainerStyle={styles.clientHomePage}>
      <View style={styles.clientHomeHeader}>
        <View>
          <Text style={styles.clientWelcome}>Hola, {firstName(session.fullName)}</Text>
          <View style={styles.clientLocationRow}><Ionicons name="football-outline" size={15} color="#58c83c" /><Text style={styles.clientLocation}>Reserva tu cancha</Text></View>
        </View>
        <Pressable style={styles.refreshButton} onPress={loadDashboard} disabled={loading}><Ionicons name="refresh" size={22} color="#ffffff" /></Pressable>
      </View>

      <View style={styles.clientHeroCard}>
        <View style={styles.clientHeroCopy}>
          <Text style={styles.clientHeroTitle}>Tu próximo partido empieza aquí</Text>
          <Text style={styles.clientHeroText}>Elige una cancha y reserva un horario disponible en pocos pasos.</Text>
          <Pressable style={styles.clientReserveButton} onPress={openCourts}><Ionicons name="football" size={20} color="#ffffff" /><Text style={styles.quickActionText}>Reservar cancha</Text></Pressable>
        </View>
        <Ionicons name="football-outline" size={74} color="#58c83c" />
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Tu próxima reserva</Text>
        <Pressable onPress={openReservations}><Text style={styles.greenLink}>Ver todas</Text></Pressable>
      </View>
      {nextReservation ? (
        <Pressable style={styles.clientReservationCard} onPress={openReservations}>
          <View style={styles.clientReservationDate}><Ionicons name="calendar" size={23} color="#58c83c" /><Text style={styles.clientReservationDay}>{nextReservation.date}</Text></View>
          <View style={styles.clientReservationInfo}>
            <Text style={styles.clientReservationCourt}>{nextReservation.courtName}</Text>
            <Text style={styles.clientReservationTime}>{to12Hour(nextReservation.startTime)} - {to12Hour(nextReservation.endTime)}</Text>
            <Text style={[styles.clientPaymentStatus, nextReservation.paymentStatus === 'PAGADO' && styles.greenText]}>{labelPaymentStatus(nextReservation.paymentStatus)} - S/ {formatMoney(nextReservation.totalAmount)}</Text>
          </View>
          <Ionicons name="chevron-forward" size={23} color="#7f8d92" />
        </Pressable>
      ) : <EmptyCard text="No tienes reservas próximas." />}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Disponibles hoy</Text>
        <Pressable onPress={openCourts}><Text style={styles.greenLink}>Ver canchas</Text></Pressable>
      </View>
      {dashboard.nextAvailableSlots.length === 0 ? <EmptyCard text="No quedan horarios disponibles para hoy. Revisa otra fecha." /> : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.clientAvailabilityRow}>
          {dashboard.nextAvailableSlots.map((slot, index) => {
            const court = courts.find((item) => item.id === slot.courtId);
            return (
              <Pressable key={slot.courtId} style={styles.clientAvailabilityCard} onPress={() => court && openCourt(court)}>
                <Image source={{ uri: slot.imageUrl ? resolveApiUrl(slot.imageUrl) : courtImages[index % courtImages.length] }} style={styles.clientAvailabilityImage} />
                <Text style={styles.clientAvailabilityCourt}>{slot.courtName}</Text>
                <View style={styles.clientAvailabilityTimeRow}><Ionicons name="time-outline" size={16} color="#58c83c" /><Text style={styles.clientAvailabilityTime}>{to12Hour(slot.startTime)}</Text></View>
                <Text style={styles.clientAvailabilityPrice}>S/ {formatMoney(slot.price)} por hora</Text>
                <Text style={styles.clientAvailabilityAction}>Reservar</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </ScrollView>
  );
}

function ManagedDashboard({
  session,
  courts,
  openCourt,
  openReservations,
  openCourts
}: {
  session: AuthResponse;
  courts: Court[];
  openCourt: (court: Court) => void;
  openReservations: () => void;
  openCourts: () => void;
}) {
  const [dashboard, setDashboard] = useState<OperationsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadDashboard = async () => {
    try {
      setLoading(true);
      setError('');
      setDashboard(await api<OperationsDashboard>('/dashboard/operations'));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo cargar el resumen.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const openWhatsApp = (reservation: OperationsReservation) => {
    if (!reservation.clientPhone) {
      Alert.alert('Sin celular', 'Esta reserva no tiene un celular registrado.');
      return;
    }
    const message = `Hola ${reservation.clientName}, le escribimos de ReserGrass sobre su reserva de ${to12Hour(reservation.startTime)} a ${to12Hour(reservation.endTime)} en ${reservation.courtName}.`;
    Linking.openURL(`https://wa.me/${normalizeWhatsappPhone(reservation.clientPhone)}?text=${encodeURIComponent(message)}`);
  };

  if (loading && !dashboard) {
    return <View style={styles.managedLoading}><ActivityIndicator color="#58c83c" size="large" /><Text style={styles.bodyCopy}>Cargando operaciones de hoy...</Text></View>;
  }

  if (!dashboard) {
    return (
      <View style={styles.managedLoading}>
        <Ionicons name="cloud-offline-outline" size={46} color="#e46b62" />
        <Text style={styles.managedError}>{error}</Text>
        <Pressable style={styles.primaryAction} onPress={loadDashboard}><Text style={styles.activeText}>Reintentar</Text></Pressable>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.managedPage}>
      <View style={styles.managedHeader}>
        <View>
          <Text style={styles.managedEyebrow}>{session.role === 'ADMIN' ? 'PANEL ADMINISTRATIVO' : 'PANEL DE ATENCION'}</Text>
          <Text style={styles.managedTitle}>Hola, {firstName(session.fullName)}</Text>
          <Text style={styles.managedDate}>Operaciones de hoy - {dashboard.date}</Text>
        </View>
        <Pressable style={styles.refreshButton} onPress={loadDashboard} disabled={loading}>
          <Ionicons name="refresh" size={22} color="#ffffff" />
        </Pressable>
      </View>

      <View style={styles.quickActions}>
        <Pressable style={styles.quickPrimary} onPress={openCourts}>
          <Ionicons name="add-circle" size={25} color="#ffffff" />
          <Text style={styles.quickActionText}>Nueva reserva</Text>
        </Pressable>
        <Pressable style={styles.quickSecondary} onPress={openReservations}>
          <Ionicons name="calendar" size={23} color="#58c83c" />
          <Text style={styles.quickSecondaryText}>Ver agenda</Text>
        </Pressable>
      </View>

      <View style={styles.metricGrid}>
        <OperationMetric icon="calendar-outline" value={dashboard.totalReservations} label="Reservas de hoy" color="#58c83c" />
        <OperationMetric icon="football-outline" value={`${dashboard.occupiedCourts}/${dashboard.totalCourts}`} label="Canchas ocupadas" color="#ef5a4f" />
        <OperationMetric icon="time-outline" value={dashboard.pendingReservations} label="Por confirmar" color="#f1ad3d" />
        <OperationMetric
          icon={session.role === 'ADMIN' ? 'cash-outline' : 'card-outline'}
          value={session.role === 'ADMIN' ? `S/ ${formatMoney(dashboard.collectedAmount)}` : dashboard.pendingPayments}
          label={session.role === 'ADMIN' ? 'Cobrado hoy' : 'Pagos pendientes'}
          color="#3ba8e8"
        />
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Estado de las canchas</Text>
        <Pressable onPress={openCourts}><Text style={styles.greenLink}>Reservar</Text></Pressable>
      </View>
      {dashboard.courts.map((item) => {
        const court = courts.find((candidate) => candidate.id === item.courtId);
        const activeReservation = item.currentReservation ?? item.nextReservation;
        return (
          <Pressable key={item.courtId} style={styles.operationCourtCard} onPress={() => court && openCourt(court)}>
            <View style={[styles.operationStatusBar, item.status === 'LIBRE' ? styles.operationFree : item.status === 'OCUPADA' ? styles.operationBusy : styles.operationWarning]} />
            <View style={styles.operationCourtBody}>
              <View style={styles.operationCourtHeader}>
                <Text style={styles.operationCourtName}>{item.courtName}</Text>
                <Text style={[styles.operationStatusText, item.status === 'LIBRE' && styles.greenText]}>{item.status}</Text>
              </View>
              {activeReservation ? (
                <View>
                  <Text style={styles.operationClient}>{item.currentReservation ? 'Ahora' : 'Siguiente'}: {activeReservation.clientName}</Text>
                  <Text style={styles.operationTime}>{to12Hour(activeReservation.startTime)} - {to12Hour(activeReservation.endTime)}</Text>
                </View>
              ) : <Text style={styles.operationTime}>Sin reservas proximas</Text>}
            </View>
            <Ionicons name="chevron-forward" size={22} color="#758287" />
          </Pressable>
        );
      })}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Proximas reservas</Text>
        <Pressable onPress={openReservations}><Text style={styles.greenLink}>Ver agenda</Text></Pressable>
      </View>
      {dashboard.upcomingReservations.length === 0 ? <EmptyCard text="No quedan reservas para hoy." /> : dashboard.upcomingReservations.map((item) => (
        <View key={item.id} style={styles.upcomingOperationCard}>
          <View style={styles.upcomingTimeBox}>
            <Text style={styles.upcomingTime}>{to12Hour(item.startTime)}</Text>
            <Text style={styles.upcomingCourt}>{item.courtName}</Text>
          </View>
          <View style={styles.upcomingInfo}>
            <Text style={styles.operationClient}>{item.clientName}</Text>
            <Text style={styles.operationTime}>{item.paymentStatus === 'PAGADO' ? 'Pago confirmado' : 'Pago pendiente'} - S/ {formatMoney(item.totalAmount)}</Text>
          </View>
          {!!item.clientPhone && (
            <Pressable style={styles.whatsappMiniButton} onPress={() => openWhatsApp(item)}>
              <Ionicons name="logo-whatsapp" size={21} color="#ffffff" />
            </Pressable>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

function OperationMetric({ icon, value, label, color }: { icon: keyof typeof Ionicons.glyphMap; value: string | number; label: string; color: string }) {
  return (
    <View style={styles.operationMetric}>
      <View style={[styles.metricIcon, { backgroundColor: `${color}22` }]}><Ionicons name={icon} size={22} color={color} /></View>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function CourtsScreen({ courts, openCourt }: { courts: Court[]; openCourt: (court: Court) => void }) {
  return (
    <View style={styles.pageFixed}>
      <View style={styles.navTitle}>
        <Ionicons name="arrow-back" size={24} color="#ffffff" />
        <Text style={styles.navText}>Nuestras canchas</Text>
        <Ionicons name="filter" size={22} color="#ffffff" />
      </View>
      <FlatList
        data={courts}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.courtList}
        ListEmptyComponent={<EmptyCard text="No hay canchas registradas." />}
        renderItem={({ item, index }) => (
          <Pressable style={styles.courtRow} onPress={() => openCourt(item)}>
            <Image source={{ uri: courtImages[index % courtImages.length] }} style={styles.courtThumb} />
            <View style={styles.courtInfo}>
              <Text style={styles.courtName}>{item.name}</Text>
              <Text style={styles.courtDesc}>{item.description ?? 'Grass sintético'}</Text>
              <View style={styles.rowCenter}>
                <Text style={[styles.badge, item.active ? styles.badgeOk : styles.badgeOff]}>{item.active ? 'Disponible' : 'No disponible'}</Text>
                <Text style={styles.price}>S/ {formatMoney(item.hourlyPrice)} / hora</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={26} color="#ffffff" />
          </Pressable>
        )}
      />
    </View>
  );
}

function CourtDetailScreen({ court, session, onBack, onReserved }: { court: Court; session: AuthResponse; onBack: () => void; onReserved: (draft: ReservationDraft) => void }) {
  const [dateIndex, setDateIndex] = useState(0);
  const [time, setTime] = useState('');
  const [durationHours, setDurationHours] = useState(1);
  const [slots, setSlots] = useState<CalendarSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [busy, setBusy] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [selectedReservationSlot, setSelectedReservationSlot] = useState<CalendarSlot | null>(null);
  const [quote, setQuote] = useState<ReservationQuote | null>(null);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const canUseGuest = session.role === 'ADMIN' || session.role === 'PERSONAL';

  const selectedSlotIndex = slots.findIndex((slot) => slot.startTime === time);
  const consecutiveSlots = selectedSlotIndex < 0 ? [] : slots.slice(selectedSlotIndex).reduce<CalendarSlot[]>((result, slot) => {
    const previous = result[result.length - 1];
    if (slot.status !== 'DISPONIBLE' || (previous && previous.endTime !== slot.startTime)) return result;
    result.push(slot);
    return result;
  }, []);
  const durationOptions = consecutiveSlots.map((_, index) => index + 1);
  const quoteEndTime = consecutiveSlots[consecutiveSlots.length - 1]?.endTime ?? '';
  const canSelectDuration = (hours: number) => {
    if (selectedSlotIndex < 0) return false;
    const range = slots.slice(selectedSlotIndex, selectedSlotIndex + hours);
    return range.length === hours && range.every((slot, index) =>
      slot.status === 'DISPONIBLE'
      && (index === 0 || range[index - 1].endTime === slot.startTime)
    );
  };

  useEffect(() => {
    let active = true;
    const selectedDate = dateOptions[dateIndex].iso;
    const loadSlots = async () => {
      try {
        setLoadingSlots(true);
        const calendar = await api<CalendarSlot[]>(`/schedules/calendar?courtId=${court.id}&date=${selectedDate}`);
        if (!active) return;
        setSlots(calendar);
        setTime((current) => calendar.some((slot) => slot.startTime === current && slot.status === 'DISPONIBLE')
          ? current
          : calendar.find((slot) => slot.status === 'DISPONIBLE')?.startTime ?? '');
        setDurationHours(1);
      } catch (error) {
        if (active) {
          setSlots([]);
          setTime('');
          Alert.alert('Horarios', error instanceof Error ? error.message : 'No se pudieron cargar los horarios.');
        }
      } finally {
        if (active) setLoadingSlots(false);
      }
    };
    loadSlots();
    const unsubscribe = subscribeAvailability(court.id, selectedDate, loadSlots);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [court.id, dateIndex]);

  useEffect(() => {
    let active = true;
    if (!time || !quoteEndTime) {
      setQuote(null);
      return () => { active = false; };
    }
    const loadQuote = async () => {
      try {
        setLoadingQuote(true);
        const selectedDate = dateOptions[dateIndex].iso;
        const result = await api<ReservationQuote>(
          `/reservations/quote?courtId=${court.id}&date=${selectedDate}&startTime=${time}&endTime=${quoteEndTime}`
        );
        if (active) setQuote(result);
      } catch {
        if (active) setQuote(null);
      } finally {
        if (active) setLoadingQuote(false);
      }
    };
    loadQuote();
    return () => { active = false; };
  }, [court.id, dateIndex, time, quoteEndTime]);

  const priceForDuration = (hours: number) => {
    const targetEnd = consecutiveSlots[hours - 1]?.endTime;
    if (!quote || !targetEnd) return null;
    return quote.breakdown
      .filter((item) => item.endTime <= targetEnd)
      .reduce((total, item) => total + Number(item.amount), 0);
  };

  const reserve = async () => {
    const selectedSlot = slots.find((slot) => slot.startTime === time && slot.status === 'DISPONIBLE');
    const selectedDate = dateOptions[dateIndex];
    if (!selectedSlot) {
      Alert.alert('Horario requerido', 'Selecciona un horario disponible.');
      return;
    }
    if (!canSelectDuration(durationHours)) {
      Alert.alert('Duración no disponible', 'Selecciona horas consecutivas que estén disponibles.');
      return;
    }
    const endTime = slots[selectedSlotIndex + durationHours - 1].endTime;
    if (canUseGuest && !guestName.trim()) {
      Alert.alert('Nombre requerido', 'Ingresa el nombre de la persona que llama para registrar la reserva.');
      return;
    }
    if (canUseGuest && !/^9\d{8}$/.test(guestPhone)) {
      Alert.alert('Celular requerido', 'Ingresa un celular de 9 dígitos que comience con 9.');
      return;
    }

    try {
      setBusy(true);
      const reservation = await api<Reservation>('/reservations', {
        method: 'POST',
        body: {
          courtId: court.id,
          guestName: canUseGuest ? guestName.trim() : undefined,
          guestPhone: canUseGuest ? guestPhone.trim() || undefined : undefined,
          reservationDate: selectedDate.iso,
          startTime: time,
          endTime
        }
      });
      onReserved({ court, reservation, date: selectedDate.iso, displayDate: selectedDate.longLabel, startTime: time, endTime });
    } catch (error) {
      Alert.alert('No se pudo reservar', error instanceof Error ? error.message : 'Error desconocido');
    } finally {
      setBusy(false);
    }
  };

  const contactReservedClient = () => {
    if (!selectedReservationSlot?.reservationPhone) return;
    const phone = normalizeWhatsappPhone(selectedReservationSlot.reservationPhone);
    const message = [
      `Hola ${selectedReservationSlot.reservationName ?? ''}.`,
      '',
      'Le escribimos de ReserGrass acerca de su reserva.',
      `Cancha: ${court.name}`,
      `Fecha: ${dateOptions[dateIndex].iso}`,
      `Hora: ${to12Hour(selectedReservationSlot.reservationStartTime ?? selectedReservationSlot.startTime)} - ${to12Hour(selectedReservationSlot.reservationEndTime ?? selectedReservationSlot.endTime)}`
    ].join('\n');
    Linking.openURL(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`);
  };

  return (
    <ScrollView style={styles.detailScreen} contentContainerStyle={styles.detailContent}>
      <ImageBackground source={{ uri: courtImages[court.id % courtImages.length] }} style={styles.detailHero} imageStyle={styles.detailHeroImage}>
        <View style={styles.heroShade} />
        <Pressable style={styles.backOverlay} onPress={onBack}>
          <Ionicons name="arrow-back" size={26} color="#ffffff" />
        </Pressable>
        <View style={styles.heroTitleWrap}>
          <Text style={styles.detailTitle}>{court.name}</Text>
          <Text style={styles.detailSub}>{court.description ?? 'Grass sintético'}</Text>
        </View>
      </ImageBackground>

      <Text style={styles.detailPrice}>S/ {formatMoney(court.hourlyPrice)} <Text style={styles.priceUnit}>/ hora</Text></Text>
      <Text style={styles.sectionTitle}>Selecciona fecha</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dateRow}>
        {dateOptions.map((item, index) => (
          <Pressable key={item.iso} style={[styles.datePill, index === dateIndex && styles.datePillActive]} onPress={() => setDateIndex(index)}>
            <Text style={[styles.dateDow, index === dateIndex && styles.activeText]}>{item.dayName}</Text>
            <Text style={[styles.dateDay, index === dateIndex && styles.activeText]}>{item.day}</Text>
            <Text style={[styles.dateMonth, index === dateIndex && styles.activeText]}>{item.month}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <Text style={styles.sectionTitle}>Horarios disponibles</Text>
      {loadingSlots ? (
        <ActivityIndicator color="#58c83c" />
      ) : slots.length === 0 ? (
        <EmptyCard text="No hay horarios configurados para este día." />
      ) : (
        <View style={styles.timeGrid}>
          {slots.map((slot, index) => {
            const available = slot.status === 'DISPONIBLE';
            const reserved = slot.status === 'RESERVADO' || slot.status === 'PENDIENTE';
            const selected = selectedSlotIndex >= 0
              && index >= selectedSlotIndex
              && index < selectedSlotIndex + durationHours
              && canSelectDuration(durationHours);
            return (
              <Pressable
                key={`${slot.startTime}-${slot.endTime}`}
                style={[
                  styles.slot,
                  !available && !reserved && styles.slotDisabled,
                  reserved && styles.slotReserved,
                  selected && styles.slotActive
                ]}
                onPress={() => {
                  if (available) {
                    setTime(slot.startTime);
                    setDurationHours(1);
                  } else if (canUseGuest && reserved && slot.reservationId) {
                    setSelectedReservationSlot(slot);
                  }
                }}
                disabled={!available && !(canUseGuest && reserved)}
              >
                <Text style={[styles.slotText, !available && !reserved && styles.slotTextDisabled, selected && styles.activeText]}>
                  {reserved
                    ? canUseGuest && slot.reservationName
                      ? `Reservado\n${slot.reservationName}`
                      : 'Reservado'
                    : `${to12Hour(slot.startTime)}\nS/ ${formatMoney(slot.price ?? court.hourlyPrice)}`}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
      {!!time && (
        <>
          <Text style={styles.sectionTitle}>¿Cuántas horas deseas?</Text>
          <View style={styles.durationRow}>
            {durationOptions.map((hours) => {
              const enabled = canSelectDuration(hours);
              return (
                <Pressable
                  key={hours}
                  style={[styles.durationOption, durationHours === hours && styles.durationOptionActive, !enabled && styles.durationOptionDisabled]}
                  onPress={() => setDurationHours(hours)}
                  disabled={!enabled}
                >
                  <Text style={[styles.durationOptionText, durationHours === hours && styles.activeText]}>
                    {hours} {hours === 1 ? 'hora' : 'horas'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.selectionSummary}>
            Reserva: {to12Hour(time)} - {to12Hour(slots[selectedSlotIndex + durationHours - 1]?.endTime ?? time)}
          </Text>
          {loadingQuote ? (
            <ActivityIndicator color="#58c83c" />
          ) : quote ? (
            <View style={styles.priceBreakdownCard}>
              <Text style={styles.priceBreakdownTitle}>Detalle del precio</Text>
              {quote.breakdown
                .filter((item) => item.endTime <= (consecutiveSlots[durationHours - 1]?.endTime ?? time))
                .map((item) => (
                  <View key={`${item.startTime}-${item.endTime}`} style={styles.priceBreakdownRow}>
                    <Text style={styles.priceBreakdownLabel}>{to12Hour(item.startTime)} - {to12Hour(item.endTime)}</Text>
                    <Text style={styles.priceBreakdownAmount}>S/ {formatMoney(item.amount)}</Text>
                  </View>
                ))}
              <View style={styles.priceTotalRow}>
                <Text style={styles.priceTotalLabel}>Total por {durationHours} {durationHours === 1 ? 'hora' : 'horas'}</Text>
                <Text style={styles.priceTotalAmount}>S/ {formatMoney(priceForDuration(durationHours) ?? 0)}</Text>
              </View>
            </View>
          ) : null}
        </>
      )}
      {canUseGuest && (
        <View style={styles.adminCard}>
          <Text style={styles.sectionTitle}>Datos de quien llama</Text>
          <AdminInput label="Nombre *" placeholder="Nombre del cliente" value={guestName} onChangeText={setGuestName} />
          <AdminInput label="Celular *" placeholder="987 654 321" value={guestPhone} onChangeText={(value) => setGuestPhone(toNineDigits(value))} keyboardType="number-pad" maxLength={9} />
        </View>
      )}
      <Button title={busy ? 'Reservando...' : 'Reservar ahora'} onPress={reserve} disabled={busy || !court.active || !time} />
      <Modal visible={Boolean(selectedReservationSlot)} transparent animationType="fade" onRequestClose={() => setSelectedReservationSlot(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.saveConfirmationModal}>
            <View style={[styles.saveSuccessIcon, { backgroundColor: '#d93a32' }]}>
              <Ionicons name="calendar" size={34} color="#ffffff" />
            </View>
            <Text style={styles.saveConfirmationEyebrow}>RESERVA OCUPADA</Text>
            <Text style={styles.saveConfirmationTitle}>{selectedReservationSlot?.reservationName ?? 'Cliente'}</Text>
            <View style={styles.saveSummaryCard}>
              <SummaryRow label="Cancha" value={court.name} />
              <SummaryRow label="Fecha" value={dateOptions[dateIndex].iso} />
              <SummaryRow
                label="Horario"
                value={`${to12Hour(selectedReservationSlot?.reservationStartTime ?? selectedReservationSlot?.startTime ?? '')} - ${to12Hour(selectedReservationSlot?.reservationEndTime ?? selectedReservationSlot?.endTime ?? '')}`}
              />
              <SummaryRow label="Celular" value={selectedReservationSlot?.reservationPhone ?? 'No registrado'} />
            </View>
            {selectedReservationSlot?.reservationPhone && (
              <Button title="Escribir por WhatsApp" onPress={contactReservedClient} />
            )}
            <Pressable onPress={() => setSelectedReservationSlot(null)}>
              <Text style={styles.mutedCenter}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function SuccessScreen({ draft, onHome, onReservations }: { draft: ReservationDraft; onHome: () => void; onReservations: () => void }) {
  const [config, setConfig] = useState<PaymentConfig | null>(null);
  const [remaining, setRemaining] = useState(secondsUntil(draft.reservation.paymentExpiresAt));

  useEffect(() => {
    api<PaymentConfig>('/payment-config').then(setConfig).catch(() => undefined);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setRemaining(secondsUntil(draft.reservation.paymentExpiresAt)), 1000);
    return () => clearInterval(timer);
  }, [draft.reservation.paymentExpiresAt]);

  const openWhatsApp = () => {
    const phone = normalizeWhatsappPhone(config?.whatsappPhoneNumber ?? '987654321');
    const message = [
      'Hola.',
      '',
      'Acabo de realizar una reserva.',
      '',
      `Reserva N: R${String(draft.reservation.id).padStart(6, '0')}`,
      `Nombre: ${draft.reservation.clientName}`,
      `Cancha: ${draft.reservation.courtName}`,
      `Fecha: ${draft.date}`,
      `Hora: ${to12Hour(draft.startTime)} - ${to12Hour(draft.endTime)}`,
      `Monto: S/ ${formatMoney(draft.reservation.totalAmount)}`,
      '',
      'Adjunto mi comprobante de pago para su validacion.'
    ].join('\n');
    Linking.openURL(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`);
  };

  return (
    <ScrollView contentContainerStyle={styles.successScreen}>
      <View style={styles.successCircle}>
        <Ionicons name="checkmark" size={72} color="#ffffff" />
      </View>
      <Text style={styles.successTitle}>Tu reserva ha sido creada.</Text>
      <Text style={styles.centerCopy}>Para confirmar tu reserva realiza el pago por Yape y envia el comprobante por WhatsApp.</Text>
      <View style={styles.countdownCard}>
        <Text style={styles.fieldLabel}>Tiempo restante para confirmar</Text>
        <Text style={styles.countdownText}>{formatCountdown(remaining)}</Text>
      </View>
      {config && (
        <View style={styles.paymentBox}>
          <View style={styles.qrRow}>
            <View style={styles.qrItem}>
              <Image source={{ uri: resolveApiUrl(config.yapeQrUrl) }} style={styles.qrImage} />
              <Text style={styles.greenLink}>Yape</Text>
            </View>
          </View>
          <SummaryRow label="Numero Yape" value={config.yapePhoneNumber} />
          <SummaryRow label="WhatsApp" value={config.whatsappPhoneNumber} />
          <SummaryRow label="Titular" value={config.ownerName} />
        </View>
      )}
      <View style={styles.summaryCard}>
        <SummaryRow label="Cancha" value={draft.court.name} />
        <SummaryRow label="Fecha" value={draft.displayDate} />
        <SummaryRow label="Hora" value={`${to12Hour(draft.startTime)} - ${to12Hour(draft.endTime)}`} />
        <SummaryRow label="Monto a pagar" value={`S/ ${formatMoney(draft.reservation.totalAmount)}`} />
        <SummaryRow label="Estado" value={labelPaymentStatus(draft.reservation.paymentStatus)} />
      </View>
      <Button title="Enviar comprobante por WhatsApp" onPress={openWhatsApp} />
      <Button title="Ver mis reservas" onPress={onReservations} />
      <Pressable onPress={onHome}>
        <Text style={styles.mutedCenter}>Volver al inicio</Text>
      </Pressable>
    </ScrollView>
  );
}

function ReservationsScreen({
  reservations,
  courts,
  canManage,
  refreshParent
}: {
  reservations: Reservation[];
  courts: Court[];
  canManage: boolean;
  refreshParent: () => void;
}) {
  const [items, setItems] = useState<Reservation[]>(reservations);
  const [courtIndex, setCourtIndex] = useState(0);
  const [dateIndex, setDateIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [paymentReservation, setPaymentReservation] = useState<Reservation | null>(null);
  const [historyReservation, setHistoryReservation] = useState<Reservation | null>(null);
  const [history, setHistory] = useState<ReservationAudit[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const loadManagedReservations = async () => {
    const court = courts[courtIndex];
    const date = managementDateOptions[dateIndex];
    if (!canManage || !court || !date) return;
    try {
      setLoading(true);
      const data = await api<Reservation[]>(`/reservations?courtId=${court.id}&date=${date.iso}`);
      setItems(data);
    } catch (error) {
      setItems([]);
      Alert.alert('Reservas', error instanceof Error ? error.message : 'No se pudieron cargar las reservas.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canManage) {
      loadManagedReservations();
    } else {
      setItems(reservations);
    }
  }, [canManage, courtIndex, dateIndex, courts, reservations]);

  const runAction = async (action: () => Promise<unknown>) => {
    try {
      await action();
      await loadManagedReservations();
      await refreshParent();
    } catch (error) {
      Alert.alert('Reserva', error instanceof Error ? error.message : 'No se pudo actualizar la reserva.');
    }
  };

  const askConfirmation = (title: string, message: string, confirmText: string, action: () => void, destructive = false) => {
    Alert.alert(title, message, [
      { text: 'Volver', style: 'cancel' },
      { text: confirmText, style: destructive ? 'destructive' : 'default', onPress: action }
    ]);
  };
  const confirmPayment = (reservation: Reservation) => askConfirmation(
    'Confirmar pago',
    `¿Confirmar el pago de S/ ${formatMoney(reservation.totalAmount)} de ${reservation.clientName}?`,
    'Confirmar pago',
    () => runAction(() => api<Reservation>(`/reservations/${reservation.id}/payment/confirm?method=Yape`, { method: 'PATCH' }))
  );
  const markLocalPayment = (reservation: Reservation) => askConfirmation(
    'Pago en el local',
    `¿Marcar la reserva de ${reservation.clientName} como pago en el local?`,
    'Marcar pago local',
    () => runAction(() => api<Reservation>(`/reservations/${reservation.id}/payment/local`, { method: 'PATCH' }))
  );
  const rejectPayment = (reservation: Reservation) => askConfirmation(
    'Rechazar pago',
    `¿Rechazar el pago de ${reservation.clientName}? La reserva volverá a estado pendiente.`,
    'Rechazar',
    () => runAction(() => api<Reservation>(`/reservations/${reservation.id}/payment/reject?reason=${encodeURIComponent('Pago rechazado por administracion')}`, { method: 'PATCH' })),
    true
  );
  const cancelReservation = (reservation: Reservation) => askConfirmation(
    'Cancelar reserva',
    `¿Cancelar la reserva de ${reservation.clientName} en ${reservation.courtName}, de ${to12Hour(reservation.startTime)} a ${to12Hour(reservation.endTime)}?`,
    'Cancelar reserva',
    () => runAction(() => api<Reservation>(`/reservations/${reservation.id}/status?status=CANCELADA&reason=${encodeURIComponent('Cancelada por el personal')}`, { method: 'PATCH' })),
    true
  );
  const restoreReservation = (reservation: Reservation) => askConfirmation(
    'Restaurar reserva',
    'Se comprobará que el horario continúe libre antes de restaurarlo.',
    'Restaurar',
    () => runAction(() => api<Reservation>(`/reservations/${reservation.id}/restore?reason=${encodeURIComponent('Restaurada por cancelacion accidental')}`, { method: 'PATCH' }))
  );
  const openHistory = async (reservation: Reservation) => {
    setHistoryReservation(reservation);
    setLoadingHistory(true);
    try {
      setHistory(await api<ReservationAudit[]>(`/reservations/${reservation.id}/history`));
    } catch (requestError) {
      setHistory([]);
      Alert.alert('Historial', requestError instanceof Error ? requestError.message : 'No se pudo cargar el historial.');
    } finally {
      setLoadingHistory(false);
    }
  };

  return (
    <View style={styles.pageFixed}>
      <View style={styles.navTitle}>
        <Text style={styles.navText}>{canManage ? 'Gestión de reservas' : 'Mis reservas'}</Text>
        <Ionicons name="calendar-outline" size={24} color="#ffffff" />
      </View>

      {canManage ? (
        <View style={styles.reservationFilters}>
          <Text style={styles.fieldLabel}>Cancha</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {courts.map((court, index) => (
              <Pressable
                key={court.id}
                style={[styles.managementFilterChip, index === courtIndex && styles.managementFilterChipActive]}
                onPress={() => setCourtIndex(index)}
              >
                <Text style={[styles.managementFilterText, index === courtIndex && styles.activeText]}>{court.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Text style={styles.fieldLabel}>Fecha</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {managementDateOptions.map((date, index) => (
              <Pressable
                key={date.iso}
                style={[styles.datePill, index === dateIndex && styles.datePillActive]}
                onPress={() => setDateIndex(index)}
              >
                <Text style={[styles.dateDow, index === dateIndex && styles.activeText]}>{date.iso === todayIso ? 'Hoy' : date.dayName}</Text>
                <Text style={[styles.dateDay, index === dateIndex && styles.activeText]}>{date.day}</Text>
                <Text style={[styles.dateMonth, index === dateIndex && styles.activeText]}>{date.month}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : (
        <Text style={styles.bodyCopy}>Consulta el horario y el estado actual de todas tus reservas.</Text>
      )}

      {loading ? (
        <ActivityIndicator color="#58c83c" style={{ marginTop: 28 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.courtList}
          ListEmptyComponent={<EmptyCard text={canManage ? 'No hay reservas para la cancha y fecha seleccionadas.' : 'Aún no tienes reservas.'} />}
          renderItem={({ item }) => (
            <View style={styles.reservationFullCard}>
              <ReservationCard reservation={item} />
              {!canManage
                && item.status === 'PENDIENTE'
                && (item.paymentStatus === 'PENDIENTE_PAGO' || item.paymentStatus === 'RECHAZADO')
                && secondsUntil(item.paymentExpiresAt) > 0 && (
                  <Pressable style={styles.clientPayButton} onPress={() => setPaymentReservation(item)}>
                    <Ionicons name="qr-code-outline" size={19} color="#ffffff" />
                    <Text style={styles.quickActionText}>Pagar ahora</Text>
                  </Pressable>
                )}
              {canManage && item.status !== 'CANCELADA' && (
                <View style={styles.adminActions}>
                  <Pressable onPress={() => confirmPayment(item)}><Text style={styles.greenLink}>Confirmar pago</Text></Pressable>
                  <Pressable onPress={() => markLocalPayment(item)}><Text style={styles.greenLink}>Pago local</Text></Pressable>
                  <Pressable onPress={() => rejectPayment(item)}><Text style={styles.danger}>Rechazar</Text></Pressable>
                  <Pressable onPress={() => cancelReservation(item)}><Text style={styles.danger}>Cancelar</Text></Pressable>
                  <Pressable onPress={() => openHistory(item)}><Text style={styles.infoLink}>Historial</Text></Pressable>
                </View>
              )}
              {canManage && item.status === 'CANCELADA' && (
                <View style={styles.cancelledReservationActions}>
                  <Pressable style={styles.restoreReservationButton} onPress={() => restoreReservation(item)}>
                    <Ionicons name="refresh-circle-outline" size={20} color="#ffffff" />
                    <Text style={styles.quickActionText}>Restaurar reserva</Text>
                  </Pressable>
                  <Pressable style={styles.historyButton} onPress={() => openHistory(item)}>
                    <Ionicons name="time-outline" size={19} color="#ffffff" />
                  </Pressable>
                </View>
              )}
            </View>
          )}
        />
      )}
      <PaymentDetailsModal reservation={paymentReservation} onClose={() => setPaymentReservation(null)} />
      <ReservationHistoryModal reservation={historyReservation} items={history} loading={loadingHistory} onClose={() => setHistoryReservation(null)} />
    </View>
  );
}

function ReservationHistoryModal({
  reservation, items, loading, onClose
}: {
  reservation: Reservation | null;
  items: ReservationAudit[];
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <Modal visible={Boolean(reservation)} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.historyModal}>
          <View style={styles.paymentModalHeader}>
            <View>
              <Text style={styles.saveConfirmationEyebrow}>BITACORA DE CAMBIOS</Text>
              <Text style={styles.saveConfirmationTitle}>Reserva R{String(reservation?.id ?? 0).padStart(6, '0')}</Text>
            </View>
            <Pressable style={styles.modalCloseButton} onPress={onClose}><Ionicons name="close" size={24} color="#ffffff" /></Pressable>
          </View>
          {loading ? <ActivityIndicator color="#58c83c" style={{ marginVertical: 30 }} /> : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {items.length === 0 ? <EmptyCard text="Esta reserva aún no tiene cambios registrados." /> : items.map((item) => (
                <View key={item.id} style={styles.historyEntry}>
                  <View style={styles.historyDot} />
                  <View style={styles.historyEntryBody}>
                    <Text style={styles.historyAction}>{item.action.replaceAll('_', ' ')}</Text>
                    <Text style={styles.historyActor}>{item.changedBy} · {new Date(item.changedAt).toLocaleString('es-PE')}</Text>
                    {(item.previousReservationStatus || item.newReservationStatus) && (
                      <Text style={styles.historyChange}>Reserva: {item.previousReservationStatus ?? '-'} → {item.newReservationStatus ?? '-'}</Text>
                    )}
                    {(item.previousPaymentStatus || item.newPaymentStatus) && (
                      <Text style={styles.historyChange}>Pago: {item.previousPaymentStatus ?? '-'} → {item.newPaymentStatus ?? '-'}</Text>
                    )}
                    {!!item.reason && <Text style={styles.historyReason}>Motivo: {item.reason}</Text>}
                  </View>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

function PaymentDetailsModal({ reservation, onClose }: { reservation: Reservation | null; onClose: () => void }) {
  const [config, setConfig] = useState<PaymentConfig | null>(null);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!reservation) return;
    setRemaining(secondsUntil(reservation.paymentExpiresAt));
    api<PaymentConfig>('/payment-config').then(setConfig).catch(() => setConfig(null));
  }, [reservation?.id]);

  useEffect(() => {
    if (!reservation) return;
    const timer = setInterval(() => setRemaining(secondsUntil(reservation.paymentExpiresAt)), 1000);
    return () => clearInterval(timer);
  }, [reservation?.id, reservation?.paymentExpiresAt]);

  const sendProof = () => {
    if (!reservation || !config) return;
    const phone = normalizeWhatsappPhone(config.whatsappPhoneNumber);
    const message = [
      'Hola.',
      '',
      'Adjunto el comprobante de pago de mi reserva.',
      `Reserva N: R${String(reservation.id).padStart(6, '0')}`,
      `Nombre: ${reservation.clientName}`,
      `Cancha: ${reservation.courtName}`,
      `Fecha: ${reservation.reservationDate}`,
      `Hora: ${to12Hour(reservation.startTime)} - ${to12Hour(reservation.endTime)}`,
      `Monto: S/ ${formatMoney(reservation.totalAmount)}`
    ].join('\n');
    Linking.openURL(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`);
  };

  return (
    <Modal visible={Boolean(reservation)} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.paymentDetailsModal}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.paymentModalHeader}>
              <View>
                <Text style={styles.saveConfirmationEyebrow}>PAGO DE RESERVA</Text>
                <Text style={styles.saveConfirmationTitle}>Paga con Yape</Text>
              </View>
              <Pressable style={styles.modalCloseButton} onPress={onClose}><Ionicons name="close" size={24} color="#ffffff" /></Pressable>
            </View>
            <Text style={styles.centerCopy}>Escanea el QR o utiliza el número Yape. Después envía tu comprobante por WhatsApp.</Text>
            <View style={styles.countdownCard}>
              <Text style={styles.fieldLabel}>Tiempo restante</Text>
              <Text style={styles.countdownText}>{formatCountdown(remaining)}</Text>
            </View>
            {config ? (
              <View style={styles.paymentBox}>
                <Image source={{ uri: resolveApiUrl(config.yapeQrUrl) }} style={[styles.qrImage, styles.paymentModalQr]} />
                <SummaryRow label="Número Yape" value={config.yapePhoneNumber} />
                <SummaryRow label="Titular" value={config.ownerName} />
              </View>
            ) : <ActivityIndicator color="#58c83c" style={{ marginVertical: 24 }} />}
            {reservation && (
              <View style={styles.summaryCard}>
                <SummaryRow label="Cancha" value={reservation.courtName} />
                <SummaryRow label="Fecha" value={reservation.reservationDate} />
                <SummaryRow label="Horario" value={`${to12Hour(reservation.startTime)} - ${to12Hour(reservation.endTime)}`} />
                <SummaryRow label="Monto" value={`S/ ${formatMoney(reservation.totalAmount)}`} />
              </View>
            )}
            <Button title="Enviar comprobante por WhatsApp" onPress={sendProof} disabled={!config || remaining <= 0} />
            {remaining <= 0 && <Text style={styles.dangerCenter}>El tiempo para pagar esta reserva terminó.</Text>}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function AdminCourtsScreen({ courts, refresh }: { courts: Court[]; refresh: () => void }) {
  const [adminCourts, setAdminCourts] = useState<Court[]>(courts);
  const [selected, setSelected] = useState<Court | null>(null);
  const [stats, setStats] = useState<CourtStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadingQr, setUploadingQr] = useState(false);
  const [view, setView] = useState<'list' | 'form' | 'prices' | 'schedule' | 'detail' | 'calendar' | 'blocks' | 'blockForm' | 'payments' | 'users' | 'userForm'>('list');
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [userQuery, setUserQuery] = useState('');
  const [userForm, setUserForm] = useState({ fullName: '', email: '', phone: '', password: '', role: 'CLIENTE' as Role });
  const [saveConfirmation, setSaveConfirmation] = useState<{
    courtName: string;
    scheduleStart: string;
    dayEnd: string;
    scheduleEnd: string;
    dayPrice: string;
    nightPrice: string;
  } | null>(null);
  const [paymentForm, setPaymentForm] = useState({
    ownerName: '',
    yapePhoneNumber: '',
    whatsappPhoneNumber: '',
    yapeQrUrl: '',
    paymentTimeoutMinutes: '15'
  });
  const [form, setForm] = useState({
    name: '',
    code: '',
    description: '',
    mainImageUrl: '',
    gallery: '',
    type: 'GRASS_SINTETICO',
    dimensions: '',
    maxPlayers: '10',
    status: 'DISPONIBLE',
    weekdayMorning: '60',
    weekdayNight: '80',
    weekend: '100',
    scheduleStart: '08:00',
    dayEnd: '17:00',
    scheduleEnd: '23:00',
    promoName: '2 horas por S/150',
    promoFixedPrice: '150',
    promoRequiredHours: '2'
  });

  useEffect(() => {
    loadAdminCourts();
    loadPaymentSettings();
    loadUsers();
  }, []);

  const filteredCourts = adminCourts.filter((court) =>
    `${court.name} ${court.code ?? ''} ${court.type ?? ''}`.toLowerCase().includes(query.toLowerCase())
  );

  const loadAdminCourts = async () => {
    try {
      const data = await api<Court[]>('/courts/all');
      setAdminCourts(data);
    } catch (error) {
      setAdminCourts(courts);
    }
  };

  const loadUsers = async () => {
    try {
      setUsers(await api<AdminUser[]>('/admin/users'));
    } catch {
      setUsers([]);
    }
  };

  const openUserForm = (user?: AdminUser) => {
    setSelectedUser(user ?? null);
    setUserForm(user
      ? { fullName: user.fullName, email: user.email, phone: user.phone ?? '', password: '', role: user.role }
      : { fullName: '', email: '', phone: '', password: '', role: 'CLIENTE' });
    setView('userForm');
  };

  const saveUser = async () => {
    if (!userForm.fullName.trim() || !userForm.email.trim() || userForm.phone.length !== 9
        || (!selectedUser && userForm.password.length < 6) || (selectedUser && userForm.password.length > 0 && userForm.password.length < 6)) {
      Alert.alert('Usuario', selectedUser
        ? 'Completa nombre, correo y celular de 9 dígitos. La nueva contraseña debe tener al menos 6 caracteres.'
        : 'Completa nombre, correo, celular de 9 dígitos y contraseña de al menos 6 caracteres.');
      return;
    }
    try {
      setBusy(true);
      const body = { ...userForm, password: userForm.password || undefined };
      await api<AdminUser>(selectedUser ? `/admin/users/${selectedUser.id}` : '/admin/users', {
        method: selectedUser ? 'PUT' : 'POST',
        body
      });
      await loadUsers();
      setSelectedUser(null);
      setView('users');
      Alert.alert(selectedUser ? 'Usuario actualizado' : 'Usuario creado',
        selectedUser ? 'Los cambios se guardaron correctamente.' : `${userForm.fullName.trim()} ya puede iniciar sesión.`);
    } catch (error) {
      Alert.alert('Usuario', error instanceof Error ? error.message : 'No se pudo crear el usuario.');
    } finally {
      setBusy(false);
    }
  };

  const changeUserRole = async (user: AdminUser) => {
    const role = user.role === 'CLIENTE' ? 'PERSONAL' : 'CLIENTE';
    try {
      await api<AdminUser>(`/admin/users/${user.id}/role?role=${role}`, { method: 'PATCH' });
      await loadUsers();
    } catch (error) {
      Alert.alert('Rol', error instanceof Error ? error.message : 'No se pudo cambiar el rol.');
    }
  };

  const toggleUserEnabled = async (user: AdminUser) => {
    try {
      await api<AdminUser>(`/admin/users/${user.id}/enabled?enabled=${!user.enabled}`, { method: 'PATCH' });
      await loadUsers();
    } catch (error) {
      Alert.alert('Cuenta', error instanceof Error ? error.message : 'No se pudo cambiar el estado.');
    }
  };
  const loadPaymentSettings = async () => {
    try {
      const data = await api<PaymentConfig>('/payment-config');
      setPaymentForm({
        ownerName: data.ownerName,
        yapePhoneNumber: data.yapePhoneNumber,
        whatsappPhoneNumber: data.whatsappPhoneNumber,
        yapeQrUrl: data.yapeQrUrl,
        paymentTimeoutMinutes: String(data.paymentTimeoutMinutes)
      });
    } catch {
      setPaymentForm((current) => current);
    }
  };

  const selectAndUploadQr = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permiso requerido', 'Permite el acceso a tus fotos para seleccionar el QR de Yape.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    try {
      setUploadingQr(true);
      const uploaded = await uploadFile<{ url: string }>('/payment-config/qr', {
        uri: asset.uri,
        name: asset.fileName ?? `qr-yape-${Date.now()}.jpg`,
        type: asset.mimeType ?? 'image/jpeg'
      });
      setPaymentForm((current) => ({ ...current, yapeQrUrl: uploaded.url }));
    } catch (error) {
      Alert.alert('No se pudo subir el QR', error instanceof Error ? error.message : 'Inténtalo nuevamente.');
    } finally {
      setUploadingQr(false);
    }
  };
  const savePaymentSettings = async () => {
    if (!paymentForm.ownerName.trim()) {
      Alert.alert('Pagos', 'Completa el nombre del titular.');
      return;
    }
    if (paymentForm.yapePhoneNumber.length !== 9 || paymentForm.whatsappPhoneNumber.length !== 9) {
      Alert.alert('Celular', 'Los números de Yape y WhatsApp deben tener exactamente 9 dígitos.');
      return;
    }
    try {
      setBusy(true);
      const saved = await api<PaymentConfig>('/payment-config', {
        method: 'PUT',
        body: {
          ownerName: paymentForm.ownerName.trim(),
          yapePhoneNumber: paymentForm.yapePhoneNumber.trim(),
          whatsappPhoneNumber: paymentForm.whatsappPhoneNumber.trim(),
          yapeQrUrl: paymentForm.yapeQrUrl.trim() || `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=YAPE-${paymentForm.yapePhoneNumber.trim()}`,
          paymentTimeoutMinutes: Number(paymentForm.paymentTimeoutMinutes || 15)
        }
      });
      setPaymentForm({
        ownerName: saved.ownerName,
        yapePhoneNumber: saved.yapePhoneNumber,
        whatsappPhoneNumber: saved.whatsappPhoneNumber,
        yapeQrUrl: saved.yapeQrUrl,
        paymentTimeoutMinutes: String(saved.paymentTimeoutMinutes)
      });
      Alert.alert('Pagos', 'Configuracion guardada correctamente.');
      setView('list');
    } catch (error) {
      Alert.alert('Pagos', error instanceof Error ? error.message : 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  };

  const selectCourt = async (court: Court) => {
    setSelected(court);
    const weekdayRules = (court.priceRules ?? [])
      .filter((rule) => rule.dayType === 'WEEKDAY')
      .sort((left, right) => left.startTime.localeCompare(right.startTime));
    setForm({
      name: court.name,
      code: court.code ?? '',
      description: court.description ?? '',
      mainImageUrl: court.mainImageUrl ?? '',
      gallery: (court.gallery ?? []).join('\n'),
      type: court.type ?? 'GRASS_SINTETICO',
      dimensions: court.dimensions ?? '',
      maxPlayers: String(court.maxPlayers ?? 10),
      status: court.status ?? 'DISPONIBLE',
      weekdayMorning: String(weekdayRules[0]?.hourlyPrice ?? 60),
      weekdayNight: String(weekdayRules[1]?.hourlyPrice ?? 80),
      weekend: String(weekdayRules[0]?.hourlyPrice ?? 60),
      scheduleStart: court.schedules?.[0]?.startTime ?? weekdayRules[0]?.startTime ?? '08:00',
      dayEnd: weekdayRules[0]?.endTime ?? '17:00',
      scheduleEnd: court.schedules?.[0]?.endTime ?? weekdayRules[1]?.endTime ?? '23:00',
      promoName: court.promotions?.[0]?.name ?? '2 horas por S/150',
      promoFixedPrice: String(court.promotions?.[0]?.fixedPrice ?? 150),
      promoRequiredHours: String(court.promotions?.[0]?.requiredHours ?? 2)
    });
    try {
      setStats(await api<CourtStats>(`/courts/${court.id}/stats`));
    } catch {
      setStats(null);
    }
  };

  const resetForm = () => {
    setSelected(null);
    setStats(null);
    setForm({
      name: '',
      code: '',
      description: '',
      mainImageUrl: '',
      gallery: '',
      type: 'GRASS_SINTETICO',
      dimensions: '',
      maxPlayers: '10',
      status: 'DISPONIBLE',
      weekdayMorning: '60',
      weekdayNight: '80',
      weekend: '100',
      scheduleStart: '08:00',
      dayEnd: '17:00',
      scheduleEnd: '23:00',
      promoName: '2 horas por S/150',
      promoFixedPrice: '150',
      promoRequiredHours: '2'
    });
  };

  const saveCourt = async () => {
    if (!form.name.trim()) {
      Alert.alert('Cancha', 'Ingresa el nombre de la cancha.');
      return;
    }
    const scheduleStart = form.scheduleStart.slice(0, 5);
    const dayEnd = form.dayEnd.slice(0, 5);
    const scheduleEnd = form.scheduleEnd.slice(0, 5);
    const validTime = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!validTime.test(scheduleStart) || !validTime.test(dayEnd) || !validTime.test(scheduleEnd)
        || scheduleStart >= dayEnd || dayEnd >= scheduleEnd) {
      Alert.alert('Horario', 'La hora final del día debe estar entre la apertura y el cierre.');
      return;
    }
    if (Number(form.weekdayMorning) < 0 || Number(form.weekdayNight) < 0) {
      Alert.alert('Tarifas', 'Los precios deben ser números válidos mayores o iguales a cero.');
      return;
    }

    const universalPriceRules = [
      { dayType: 'WEEKDAY', startTime: scheduleStart, endTime: dayEnd, hourlyPrice: Number(form.weekdayMorning || 0), active: true },
      { dayType: 'WEEKDAY', startTime: dayEnd, endTime: scheduleEnd, hourlyPrice: Number(form.weekdayNight || 0), active: true },
      { dayType: 'WEEKEND', startTime: scheduleStart, endTime: dayEnd, hourlyPrice: Number(form.weekdayMorning || 0), active: true },
      { dayType: 'WEEKEND', startTime: dayEnd, endTime: scheduleEnd, hourlyPrice: Number(form.weekdayNight || 0), active: true }
    ];

    const schedules = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'].map((dayOfWeek) => ({
      dayOfWeek,
      startTime: scheduleStart,
      endTime: scheduleEnd,
      active: true
    }));

    const body = {
      name: form.name.trim(),
      code: form.code.trim() || undefined,
      description: form.description.trim() || undefined,
      mainImageUrl: form.mainImageUrl.trim() || undefined,
      gallery: form.gallery.split('\n').map((item) => item.trim()).filter(Boolean),
      type: form.type,
      dimensions: form.dimensions.trim() || undefined,
      maxPlayers: Number(form.maxPlayers || 0),
      status: form.status,
      active: form.status !== 'DESHABILITADA',
      priceRules: universalPriceRules,

      schedules,
      promotions: form.promoName.trim()
        ? [{
          name: form.promoName.trim(),
          type: 'FIXED_PRICE',
          fixedPrice: Number(form.promoFixedPrice || 0),
          requiredHours: Number(form.promoRequiredHours || 0),
          active: true
        }]
        : []
    };

    try {
      setBusy(true);
      if (selected) {
        await api<Court>(`/courts/${selected.id}`, { method: 'PUT', body });
      } else {
        await api<Court>('/courts', { method: 'POST', body });
      }
      await loadAdminCourts();
      await refresh();
      setSaveConfirmation({
        courtName: form.name.trim(),
        scheduleStart,
        dayEnd,
        scheduleEnd,
        dayPrice: form.weekdayMorning,
        nightPrice: form.weekdayNight
      });
      resetForm();
      setView('list');
    } catch (error) {
      Alert.alert('Cancha', error instanceof Error ? error.message : 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (court: Court, status: string) => {
    try {
      await api<Court>(`/courts/${court.id}/status?status=${status}`, { method: 'PATCH' });
      await loadAdminCourts();
      await refresh();
    } catch (error) {
      Alert.alert('Estado', error instanceof Error ? error.message : 'No se pudo cambiar el estado');
    }
  };

  const deactivate = async (court: Court) => {
    try {
      await api<void>(`/courts/${court.id}`, { method: 'DELETE' });
      await loadAdminCourts();
      await refresh();
    } catch (error) {
      Alert.alert('Eliminar', error instanceof Error ? error.message : 'No se pudo desactivar');
    }
  };

  if (view === 'form') {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <AdminHeader title={selected ? 'Editar cancha' : 'Crear cancha'} onBack={() => setView('list')} />
        <View style={styles.photoStrip}>
          <View style={styles.photoPlaceholder}>
            <Ionicons name="camera-outline" size={24} color="#ffffff" />
            <Text style={styles.bodyCopy}>Agregar foto</Text>
          </View>
          {[0, 1].map((item) => (
            <Image key={item} source={{ uri: form.mainImageUrl || courtImages[item] }} style={styles.photoPreview} />
          ))}
        </View>
        <View style={styles.adminCard}>
          <Text style={styles.greenLink}>Informacion basica</Text>
          <AdminInput label="Nombre de la cancha *" placeholder="Ej: Cancha 1" value={form.name} onChangeText={(value) => setForm({ ...form, name: value })} />
          <AdminInput label="Codigo" placeholder="Ej: C001" value={form.code} onChangeText={(value) => setForm({ ...form, code: value })} />
          <SelectLine label="Tipo de cancha *" value={form.type.replace('_', ' ')} onPress={() => setForm({ ...form, type: form.type === 'GRASS_SINTETICO' ? 'FUTBOL_7' : 'GRASS_SINTETICO' })} />
          <View style={styles.twoCols}>
            <AdminInput label="Dimensiones" placeholder="Ej: 50m x 30m" value={form.dimensions} onChangeText={(value) => setForm({ ...form, dimensions: value })} />
            <AdminInput label="Capacidad" placeholder="Ej: 14 jugadores" value={form.maxPlayers} keyboardType="numeric" onChangeText={(value) => setForm({ ...form, maxPlayers: value })} />
          </View>
          <AdminInput label="Descripcion" placeholder="Describe tu cancha..." value={form.description} onChangeText={(value) => setForm({ ...form, description: value })} multiline />
        </View>

        <View style={styles.adminCard}>
          <Text style={styles.greenLink}>Horario de atención</Text>
          <Text style={styles.bodyCopy}>Define desde qué hora hasta qué hora se puede reservar esta cancha.</Text>
          <View style={styles.twoCols}>
            <TimePickerField label="Hora de apertura *" value={form.scheduleStart} onChange={(value) => setForm({ ...form, scheduleStart: value })} />
            <TimePickerField label="Hora de cierre *" value={form.scheduleEnd} onChange={(value) => setForm({ ...form, scheduleEnd: value })} />
          </View>
          <Text style={styles.muted}>Toca cada campo para elegir la hora.</Text>
        </View>
        <Button title="Siguiente" onPress={() => setView('prices')} />
      </ScrollView>
    );
  }

  if (view === 'prices') {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <AdminHeader title="Horario y tarifas" onBack={() => setView('form')} />
        <View style={styles.infoCard}>
          <Ionicons name="calendar-outline" size={28} color="#58c83c" />
          <Text style={styles.bodyCopy}>Estas tarifas se aplican de lunes a domingo.</Text>
        </View>
        <View style={styles.adminCard}>
          <Text style={styles.greenLink}>Tarifa de día</Text>
          <View style={styles.twoCols}>
            <TimePickerField label="Desde" value={form.scheduleStart} onChange={(value) => setForm({ ...form, scheduleStart: value })} />
            <TimePickerField label="Hasta" value={form.dayEnd} onChange={(value) => setForm({ ...form, dayEnd: value })} />
          </View>
          <AdminInput label="Precio por hora de día *" placeholder="S/ 60.00" value={form.weekdayMorning} keyboardType="numeric" onChangeText={(value) => setForm({ ...form, weekdayMorning: value })} />
        </View>
        <View style={styles.adminCard}>
          <Text style={styles.greenLink}>Tarifa de noche</Text>
          <View style={styles.twoCols}>
            <TimePickerField label="Desde" value={form.dayEnd} onChange={(value) => setForm({ ...form, dayEnd: value })} />
            <TimePickerField label="Hasta" value={form.scheduleEnd} onChange={(value) => setForm({ ...form, scheduleEnd: value })} />
          </View>
          <AdminInput label="Precio por hora de noche *" placeholder="S/ 80.00" value={form.weekdayNight} keyboardType="numeric" onChangeText={(value) => setForm({ ...form, weekdayNight: value })} />
        </View>
        <View style={styles.infoCard}>
          <Ionicons name="information-circle" size={28} color="#58c83c" />
          <Text style={styles.bodyCopy}>La tarifa nocturna comienza exactamente cuando termina la tarifa diurna.</Text>
        </View>
        <Button title={busy ? 'Guardando...' : 'Guardar horario y tarifas'} onPress={saveCourt} disabled={busy} />
      </ScrollView>
    );
  }

  if (view === 'schedule') {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <AdminHeader title="Horarios" onBack={() => setView('prices')} actionIcon="add" onAction={() => undefined} />
        <View style={styles.infoCard}>
          <Ionicons name="time-outline" size={30} color="#58c83c" />
          <Text style={styles.bodyCopy}>Define el horario de atencion de la cancha</Text>
        </View>
        <Text style={styles.sectionTitle}>Horario de atencion</Text>
        <View style={styles.twoCols}>
          <TimePickerField label="Hora de apertura" value={form.scheduleStart} onChange={(value) => setForm({ ...form, scheduleStart: value })} />
          <TimePickerField label="Hora de cierre" value={form.scheduleEnd} onChange={(value) => setForm({ ...form, scheduleEnd: value })} />
        </View>
        <Text style={styles.muted}>Toca cada campo para elegir la hora.</Text>
        <Text style={styles.sectionTitle}>Dias de atencion</Text>
        <View style={styles.dayGrid}>
          {['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'].map((day) => <Text key={day} style={styles.dayChip}>{day}</Text>)}
        </View>
        <Text style={styles.sectionTitle}>Intervalos de reserva</Text>
        <SelectLine label="Cada" value="30 minutos" onPress={() => undefined} />
        <Button title={busy ? 'Guardando...' : 'Guardar horario'} onPress={saveCourt} disabled={busy} />
      </ScrollView>
    );
  }

  if (view === 'detail' && selected) {
    return <AdminCourtDetail court={selected} onBack={() => setView('list')} onEdit={() => setView('form')} onCalendar={() => setView('calendar')} />;
  }

  if (view === 'calendar' && selected) {
    return <AdminCalendar court={selected} onBack={() => setView('detail')} />;
  }

  if (view === 'blocks') {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <AdminHeader title="Bloqueos de cancha" onBack={() => setView('list')} actionIcon="add" onAction={() => setView('blockForm')} />
        <SegmentTabs tabs={['Todos', 'Alquilada', 'Mantenimiento', 'Eventos']} active="Todos" />
        {adminCourts.slice(0, 4).map((court, index) => (
          <BlockRow key={court.id} court={court} index={index} />
        ))}
      </ScrollView>
    );
  }

  if (view === 'blockForm') {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <AdminHeader title="Agregar bloqueo" onBack={() => setView('blocks')} />
        <SelectLine label="Cancha *" value={selected?.name ?? 'Seleccionar cancha'} onPress={() => undefined} />
        <SelectLine label="Fecha *" value="Seleccionar fecha" onPress={() => undefined} icon="calendar-outline" />
        <SelectLine label="Tipo de bloqueo *" value="Alquilada todo el dia" onPress={() => undefined} />
        <View style={styles.switchRow}>
          <Text style={styles.sectionTitle}>Todo el dia</Text>
          <View style={styles.switchOn}><View style={styles.switchDot} /></View>
        </View>
        <AdminInput label="Motivo" placeholder="Ej: Alquiler completo, evento privado..." value="" multiline />
        <Button title="Guardar bloqueo" onPress={() => setView('blocks')} />
      </ScrollView>
    );
  }

  if (view === 'users') {
    const filteredUsers = users.filter((user) =>
      `${user.fullName} ${user.email} ${user.phone ?? ''} ${user.role}`.toLowerCase().includes(userQuery.toLowerCase())
    );
    return (
      <View style={styles.pageFixed}>
        <AdminHeader title="Usuarios y clientes" onBack={() => setView('list')} actionIcon="add" onAction={() => openUserForm()} />
        <Text style={styles.bodyCopy}>Administra clientes y encargados que pueden ingresar al sistema.</Text>
        <View style={styles.userSearchBox}>
          <Ionicons name="search" size={20} color="#9aa4ad" />
          <TextInput style={styles.searchInput} placeholder="Buscar por nombre, correo o celular" placeholderTextColor="#9aa4ad" value={userQuery} onChangeText={setUserQuery} />
        </View>
        <FlatList
          data={filteredUsers}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.courtList}
          ListEmptyComponent={<EmptyCard text="No se encontraron usuarios." />}
          renderItem={({ item }) => (
            <View style={styles.userManagementCard}>
              <View style={[styles.userAvatar, !item.enabled && styles.userAvatarDisabled]}>
                <Ionicons name="person" size={24} color="#ffffff" />
              </View>
              <View style={styles.userManagementInfo}>
                <Text style={styles.courtName}>{item.fullName}</Text>
                <Text style={styles.courtDesc}>{item.email}</Text>
                <Text style={styles.courtDesc}>{item.phone || 'Sin celular'}</Text>
                <View style={styles.userBadges}>
                  <Text style={[styles.badge, item.role === 'ADMIN' ? styles.badgeWarn : styles.badgeOk]}>{labelRole(item.role)}</Text>
                  <Text style={[styles.badge, item.enabled ? styles.badgeOk : styles.badgeOff]}>{item.enabled ? 'Activo' : 'Desactivado'}</Text>
                </View>
                <View style={styles.userActions}>
                  <Pressable onPress={() => openUserForm(item)}>
                    <Text style={styles.greenLink}>Editar</Text>
                  </Pressable>
                  {item.role !== 'ADMIN' && (
                    <>
                      <Pressable onPress={() => changeUserRole(item)}>
                        <Text style={styles.greenLink}>{item.role === 'CLIENTE' ? 'Convertir en encargado' : 'Convertir en cliente'}</Text>
                      </Pressable>
                      <Pressable onPress={() => toggleUserEnabled(item)}>
                        <Text style={item.enabled ? styles.danger : styles.greenLink}>{item.enabled ? 'Desactivar' : 'Activar'}</Text>
                      </Pressable>
                    </>
                  )}
                </View>
              </View>
            </View>
          )}
        />
      </View>
    );
  }

  if (view === 'userForm') {
    return (
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <AdminHeader title={selectedUser ? 'Editar usuario' : 'Crear usuario'} onBack={() => { setSelectedUser(null); setView('users'); }} />
        <View style={styles.infoCard}>
          <Ionicons name="shield-checkmark-outline" size={28} color="#58c83c" />
          <Text style={styles.bodyCopy}>Los clientes ven sus reservas. Los encargados pueden gestionar reservas y pagos.</Text>
        </View>
        <View style={styles.adminCard}>
          <Text style={styles.greenLink}>Datos de acceso</Text>
          <AdminInput label="Nombre completo *" placeholder="Ej: María López" value={userForm.fullName} onChangeText={(value) => setUserForm({ ...userForm, fullName: value })} />
          <AdminInput label="Correo electrónico *" placeholder="correo@ejemplo.com" value={userForm.email} onChangeText={(value) => setUserForm({ ...userForm, email: value })} keyboardType="email-address" autoCapitalize="none" />
          <AdminInput label="Celular *" placeholder="987654321" value={userForm.phone} onChangeText={(value) => setUserForm({ ...userForm, phone: toNineDigits(value) })} keyboardType="number-pad" maxLength={9} />
          <AdminInput label={selectedUser ? 'Nueva contraseña (opcional)' : 'Contraseña inicial *'} placeholder={selectedUser ? 'Déjala vacía para conservarla' : 'Mínimo 6 caracteres'} value={userForm.password} onChangeText={(value) => setUserForm({ ...userForm, password: value })} secureTextEntry />
          {selectedUser?.role !== 'ADMIN' && (
          <>
          <Text style={styles.fieldLabel}>Tipo de usuario</Text>
          <View style={styles.userRoleSelector}>
            <Pressable style={[styles.userRoleOption, userForm.role === 'CLIENTE' && styles.userRoleOptionActive]} onPress={() => setUserForm({ ...userForm, role: 'CLIENTE' })}>
              <Ionicons name="person-outline" size={23} color={userForm.role === 'CLIENTE' ? '#58c83c' : '#9aa4ad'} />
              <Text style={[styles.managementFilterText, userForm.role === 'CLIENTE' && styles.greenLink]}>Cliente</Text>
              <Text style={styles.muted}>Reserva y consulta sus estados</Text>
            </Pressable>
            <Pressable style={[styles.userRoleOption, userForm.role === 'PERSONAL' && styles.userRoleOptionActive]} onPress={() => setUserForm({ ...userForm, role: 'PERSONAL' })}>
              <Ionicons name="people-outline" size={23} color={userForm.role === 'PERSONAL' ? '#58c83c' : '#9aa4ad'} />
              <Text style={[styles.managementFilterText, userForm.role === 'PERSONAL' && styles.greenLink]}>Encargado</Text>
              <Text style={styles.muted}>Gestiona reservas y pagos</Text>
            </Pressable>
          </View>
          </>
          )}
        </View>
        <Button title={busy ? 'Guardando...' : selectedUser ? 'Guardar cambios' : 'Crear usuario'} onPress={saveUser} disabled={busy} />
      </ScrollView>
    );
  }
  if (view === 'payments') {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <AdminHeader title="Pagos con Yape" onBack={() => setView('list')} />
        <View style={styles.infoCard}>
          <Ionicons name="phone-portrait-outline" size={30} color="#58c83c" />
          <Text style={styles.bodyCopy}>Estos datos se muestran al cliente despues de crear su reserva.</Text>
        </View>
        <View style={styles.adminCard}>
          <Text style={styles.greenLink}>Datos de cobro</Text>
          <AdminInput label="Nombre del titular" placeholder="Ej: Juan Perez" value={paymentForm.ownerName} onChangeText={(value) => setPaymentForm({ ...paymentForm, ownerName: value })} />
          <AdminInput label="Numero Yape" placeholder="987654321" value={paymentForm.yapePhoneNumber} onChangeText={(value) => setPaymentForm({ ...paymentForm, yapePhoneNumber: toNineDigits(value) })} keyboardType="number-pad" maxLength={9} />
          <AdminInput label="Numero WhatsApp" placeholder="987654321" value={paymentForm.whatsappPhoneNumber} onChangeText={(value) => setPaymentForm({ ...paymentForm, whatsappPhoneNumber: toNineDigits(value) })} keyboardType="number-pad" maxLength={9} />
          <Text style={styles.fieldLabel}>QR de Yape</Text>
          <Pressable style={styles.qrUploadArea} onPress={selectAndUploadQr} disabled={uploadingQr}>
            {paymentForm.yapeQrUrl ? (
              <Image source={{ uri: resolveApiUrl(paymentForm.yapeQrUrl) }} style={styles.qrUploadPreview} />
            ) : (
              <View style={styles.qrUploadPlaceholder}>
                <Ionicons name="image-outline" size={38} color="#58c83c" />
              </View>
            )}
            <View style={styles.qrUploadInfo}>
              <Text style={styles.courtName}>{uploadingQr ? 'Subiendo imagen...' : paymentForm.yapeQrUrl ? 'Cambiar QR de Yape' : 'Subir QR de Yape'}</Text>
              <Text style={styles.bodyCopy}>Selecciona una imagen cuadrada desde tu galería.</Text>
            </View>
            {uploadingQr ? <ActivityIndicator color="#58c83c" /> : <Ionicons name="chevron-forward" size={22} color="#ffffff" />}
          </Pressable>
          <AdminInput label="Tiempo maximo de espera en minutos" placeholder="15" value={paymentForm.paymentTimeoutMinutes} onChangeText={(value) => setPaymentForm({ ...paymentForm, paymentTimeoutMinutes: value })} keyboardType="numeric" />
        </View>
        {!!paymentForm.yapeQrUrl.trim() && (
          <View style={styles.paymentPreview}>
            <Image source={{ uri: resolveApiUrl(paymentForm.yapeQrUrl.trim()) }} style={styles.qrImage} />
            <View style={{ flex: 1 }}>
              <Text style={styles.courtName}>Vista previa Yape</Text>
              <Text style={styles.bodyCopy}>{paymentForm.yapePhoneNumber || 'Numero Yape'}</Text>
              <Text style={styles.bodyCopy}>{paymentForm.ownerName || 'Titular'}</Text>
            </View>
          </View>
        )}
        <Button title={busy ? 'Guardando...' : 'Guardar configuracion'} onPress={savePaymentSettings} disabled={busy} />
      </ScrollView>
    );
  }

  return (
    <View style={styles.pageFixed}>
      <View style={styles.adminTop}>
        <Ionicons name="menu" size={28} color="#ffffff" />
        <Text style={styles.navText}>Canchas</Text>
        <Pressable style={styles.addSquare} onPress={() => { resetForm(); setView('form'); }}>
          <Ionicons name="add" size={24} color="#ffffff" />
        </Pressable>
      </View>
      <Text style={styles.bodyCopy}>Gestiona todas las canchas de tu sede</Text>
      <Pressable style={styles.infoCard} onPress={() => { loadUsers(); setView('users'); }}>
        <Ionicons name="people-outline" size={28} color="#58c83c" />
        <View style={{ flex: 1 }}>
          <Text style={styles.courtName}>Usuarios y clientes</Text>
          <Text style={styles.bodyCopy}>Crea clientes, encargados y administra sus accesos</Text>
        </View>
        <Ionicons name="chevron-forward" size={22} color="#ffffff" />
      </Pressable>
      <Pressable style={styles.infoCard} onPress={() => setView('payments')}>
        <Ionicons name="logo-whatsapp" size={28} color="#58c83c" />
        <View style={{ flex: 1 }}>
          <Text style={styles.courtName}>Configuracion de pagos</Text>
          <Text style={styles.bodyCopy}>Numero Yape, WhatsApp y QR de cobro</Text>
        </View>
        <Ionicons name="chevron-forward" size={22} color="#ffffff" />
      </Pressable>
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={20} color="#9aa4ad" />
          <TextInput style={styles.searchInput} placeholder="Buscar cancha..." placeholderTextColor="#9aa4ad" value={query} onChangeText={setQuery} />
        </View>
        <Pressable style={styles.filterButton} onPress={() => setView('blocks')}>
          <Ionicons name="filter" size={22} color="#ffffff" />
        </Pressable>
      </View>
      <FlatList
        data={filteredCourts}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.courtList}
        renderItem={({ item, index }) => (
          <Pressable style={styles.managementRow} onPress={() => { selectCourt(item); setView('detail'); }}>
            <Image source={{ uri: item.mainImageUrl || courtImages[index % courtImages.length] }} style={styles.managementThumb} />
            <View style={styles.courtInfo}>
              <Text style={styles.courtName}>{item.name}</Text>
              <Text style={styles.courtDesc}>{labelCourtType(item.type)} · {item.description ?? 'Grass sintetico'}</Text>
              <Text style={styles.price}>S/ {formatMoney(item.hourlyPrice)} / hora</Text>
            </View>
            <View style={styles.managementSide}>
              <Text style={[styles.badge, statusStyle(item.status)]}>{labelCourtStatus(item.status)}</Text>
              <Ionicons name="chevron-forward" size={20} color="#ffffff" />
            </View>
          </Pressable>
        )}
      />
      <SaveConfirmationModal summary={saveConfirmation} onClose={() => setSaveConfirmation(null)} />
    </View>
  );
}

function SaveConfirmationModal({
  summary,
  onClose
}: {
  summary: {
    courtName: string;
    scheduleStart: string;
    dayEnd: string;
    scheduleEnd: string;
    dayPrice: string;
    nightPrice: string;
  } | null;
  onClose: () => void;
}) {
  return (
    <Modal visible={Boolean(summary)} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.saveConfirmationModal}>
          <View style={styles.saveSuccessIcon}>
            <Ionicons name="checkmark" size={36} color="#ffffff" />
          </View>
          <Text style={styles.saveConfirmationEyebrow}>CONFIGURACIÓN ACTUALIZADA</Text>
          <Text style={styles.saveConfirmationTitle}>¡Cambios guardados!</Text>
          <Text style={styles.saveConfirmationCopy}>
            La cancha {summary?.courtName} ya está lista con este horario y tarifas.
          </Text>

          <View style={styles.saveSummaryCard}>
            <View style={styles.saveSummaryRow}>
              <Ionicons name="calendar-outline" size={21} color="#58c83c" />
              <View style={styles.saveSummaryText}>
                <Text style={styles.saveSummaryLabel}>Días de atención</Text>
                <Text style={styles.saveSummaryValue}>Lunes a domingo</Text>
              </View>
            </View>
            <View style={styles.saveSummaryDivider} />
            <View style={styles.saveSummaryRow}>
              <Ionicons name="time-outline" size={21} color="#58c83c" />
              <View style={styles.saveSummaryText}>
                <Text style={styles.saveSummaryLabel}>Horario de atención</Text>
                <Text style={styles.saveSummaryValue}>{summary?.scheduleStart} - {summary?.scheduleEnd}</Text>
              </View>
            </View>
            <View style={styles.saveSummaryDivider} />
            <View style={styles.saveSummaryRow}>
              <Ionicons name="sunny-outline" size={21} color="#f3c94f" />
              <View style={styles.saveSummaryText}>
                <Text style={styles.saveSummaryLabel}>Tarifa de día · {summary?.scheduleStart} - {summary?.dayEnd}</Text>
                <Text style={styles.saveSummaryValue}>S/ {summary?.dayPrice} por hora</Text>
              </View>
            </View>
            <View style={styles.saveSummaryDivider} />
            <View style={styles.saveSummaryRow}>
              <Ionicons name="moon-outline" size={21} color="#8faaff" />
              <View style={styles.saveSummaryText}>
                <Text style={styles.saveSummaryLabel}>Tarifa de noche · {summary?.dayEnd} - {summary?.scheduleEnd}</Text>
                <Text style={styles.saveSummaryValue}>S/ {summary?.nightPrice} por hora</Text>
              </View>
            </View>
          </View>

          <Pressable style={styles.saveConfirmationButton} onPress={onClose}>
            <Text style={styles.saveConfirmationButtonText}>Entendido</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function AdminInput(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={styles.adminInputWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput style={[styles.adminInput, style]} placeholderTextColor="#77808a" {...rest} />
    </View>
  );
}

function AdminHeader({ title, onBack, actionIcon, onAction }: { title: string; onBack: () => void; actionIcon?: keyof typeof Ionicons.glyphMap; onAction?: () => void }) {
  return (
    <View style={styles.adminTop}>
      <Pressable onPress={onBack}>
        <Ionicons name="arrow-back" size={26} color="#ffffff" />
      </Pressable>
      <Text style={styles.navText}>{title}</Text>
      {actionIcon ? (
        <Pressable style={styles.addSquare} onPress={onAction}>
          <Ionicons name={actionIcon} size={22} color="#ffffff" />
        </Pressable>
      ) : <View style={styles.headerSpacer} />}
    </View>
  );
}

function SegmentTabs({ tabs, active }: { tabs: string[]; active: string }) {
  return (
    <View style={styles.segmentTabs}>
      {tabs.map((tab) => (
        <Text key={tab} style={[styles.segmentTab, tab === active && styles.segmentTabActive]}>{tab}</Text>
      ))}
    </View>
  );
}

function TimePickerField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [visible, setVisible] = useState(false);
  const hours = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`);
  return (
    <View style={styles.adminInputWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable style={styles.timePickerButton} onPress={() => setVisible(true)}>
        <Text style={styles.selectValue}>{to12Hour(value)}</Text>
        <Ionicons name="time-outline" size={20} color="#58c83c" />
      </Pressable>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setVisible(false)} />
          <View style={styles.timePickerModal}>
            <View style={styles.timePickerHeader}>
              <Text style={styles.sectionTitle}>{label}</Text>
              <Pressable onPress={() => setVisible(false)}>
                <Ionicons name="close" size={25} color="#ffffff" />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.hourGrid}>
              {hours.map((hour) => (
                <Pressable
                  key={hour}
                  style={[styles.hourOption, hour === value && styles.hourOptionActive]}
                  onPress={() => {
                    onChange(hour);
                    setVisible(false);
                  }}
                >
                  <Text style={[styles.hourOptionText, hour === value && styles.activeText]}>{to12Hour(hour)}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
function SelectLine({ label, value, onPress, icon = 'chevron-down' }: { label: string; value: string; onPress: () => void; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <Pressable style={styles.selectLine} onPress={onPress}>
      <View>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={styles.selectValue}>{value}</Text>
      </View>
      <Ionicons name={icon} size={20} color="#c8d0d5" />
    </Pressable>
  );
}

function TariffRow({ time, price, onPrice }: { time: string; price: string; onPrice: (value: string) => void }) {
  return (
    <View style={styles.tariffRow}>
      <Ionicons name="time-outline" size={22} color="#c8d0d5" />
      <View style={{ flex: 1 }}>
        <Text style={styles.tariffTime}>{time}</Text>
        <Text style={styles.price}>S/ {Number(price || 0).toFixed(2)} / hora</Text>
      </View>
      <Pressable style={styles.iconBox}>
        <Ionicons name="pencil" size={18} color="#ffffff" />
      </Pressable>
      <Pressable style={styles.iconBox}>
        <Ionicons name="trash-outline" size={18} color="#ff625c" />
      </Pressable>
    </View>
  );
}

function AdminCourtDetail({ court, onBack, onEdit, onCalendar }: { court: Court; onBack: () => void; onEdit: () => void; onCalendar: () => void }) {
  const schedule = court.schedules?.find((item) => item.active);
  const scheduleLabel = schedule ? to12Hour(schedule.startTime) + ' - ' + to12Hour(schedule.endTime) : 'Sin horario';
  return (
    <ScrollView contentContainerStyle={styles.detailContent}>
      <ImageBackground source={{ uri: court.mainImageUrl || courtImages[court.id % courtImages.length] }} style={styles.adminDetailHero}>
        <View style={styles.heroShade} />
        <Pressable style={styles.backOverlay} onPress={onBack}>
          <Ionicons name="arrow-back" size={26} color="#ffffff" />
        </Pressable>
        <Text style={styles.imageCounter}>1/5</Text>
      </ImageBackground>
      <View style={styles.pageInner}>
        <View style={styles.rowCenter}>
          <Text style={styles.detailTitle}>{court.name}</Text>
          <Text style={[styles.badge, statusStyle(court.status)]}>{labelCourtStatus(court.status)}</Text>
        </View>
        <Text style={styles.detailSub}>{labelCourtType(court.type)} · {court.description ?? 'Grass sintetico'}</Text>
        <View style={styles.featureGrid}>
          <Feature icon="people-outline" value={String(court.maxPlayers || 14)} label="Jugadores" />
          <Feature icon="resize-outline" value={court.dimensions ?? '50m x 30m'} label="Dimensiones" />
          <Feature icon="time-outline" value={scheduleLabel} label="Horario" />
        </View>
        <Text style={styles.greenLink}>Precio desde</Text>
        <Text style={styles.detailPrice}>S/ {formatMoney(court.hourlyPrice)} <Text style={styles.priceUnit}>/ hora</Text></Text>
        <Text style={styles.sectionTitle}>Caracteristicas</Text>
        <View style={styles.featureList}>
          {['Iluminacion', 'Estacionamiento', 'Vestuarios', 'Duchas', 'Camerinos', 'Tribuna'].map((item) => (
            <Text key={item} style={styles.featureBullet}>● {item}</Text>
          ))}
        </View>
        <View style={styles.twoCols}>
          <Button title="Editar" variant="outline" onPress={onEdit} />
          <Button title="Ver calendario" onPress={onCalendar} />
        </View>
      </View>
    </ScrollView>
  );
}

function Feature({ icon, value, label }: { icon: keyof typeof Ionicons.glyphMap; value: string; label: string }) {
  return (
    <View style={styles.featureBox}>
      <Ionicons name={icon} size={19} color="#ffffff" />
      <View>
        <Text style={styles.featureValue}>{value}</Text>
        <Text style={styles.fieldLabel}>{label}</Text>
      </View>
    </View>
  );
}

function AdminCalendar({ court, onBack }: { court: Court; onBack: () => void }) {
  const days = Array.from({ length: 35 }, (_, index) => index + 1);
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <AdminHeader title={`Calendario - ${court.name}`} onBack={onBack} actionIcon="filter" />
      <View style={styles.calendarNav}>
        <Ionicons name="chevron-back" size={22} color="#ffffff" />
        <Text style={styles.navText}>Julio 2024</Text>
        <Ionicons name="chevron-forward" size={22} color="#ffffff" />
      </View>
      <View style={styles.weekRow}>
        {['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'].map((day) => <Text key={day} style={styles.weekDay}>{day}</Text>)}
      </View>
      <View style={styles.calendarGrid}>
        {days.map((day) => (
          <View key={day} style={[styles.calendarDay, day === 9 && styles.calendarDayActive]}>
            <Text style={styles.calendarNumber}>{day}</Text>
            <View style={styles.dotRow}>
              <View style={[styles.dot, { backgroundColor: day % 5 === 0 ? '#ff493b' : '#58c83c' }]} />
              {day % 3 === 0 && <View style={[styles.dot, { backgroundColor: '#d7b51f' }]} />}
            </View>
          </View>
        ))}
      </View>
      <View style={styles.legendGrid}>
        <Legend color="#58c83c" text="Disponible" />
        <Legend color="#d7b51f" text="Pendiente" />
        <Legend color="#ff493b" text="Reservado" />
        <Legend color="#9aa4ad" text="No disponible" />
        <Legend color="#2f80ed" text="Alquilada todo el dia" />
        <Legend color="#7b61ff" text="Mantenimiento" />
        <Legend color="#a855f7" text="Evento privado" />
      </View>
      <Button title="Ver agenda diaria" onPress={() => undefined} />
    </ScrollView>
  );
}

function Legend({ color, text }: { color: string; text: string }) {
  return <Text style={styles.legendText}><Text style={{ color }}>●</Text> {text}</Text>;
}

function BlockRow({ court, index }: { court: Court; index: number }) {
  const variants = [
    { color: '#2f80ed', title: 'Alquilada todo el dia', date: 'Martes, 9 Jul 2024' },
    { color: '#a855f7', title: 'Evento privado', date: 'Viernes, 12 Jul 2024' },
    { color: '#d7b51f', title: 'Mantenimiento', date: 'Sabado, 13 Jul 2024' },
    { color: '#ff493b', title: 'No disponible', date: 'Domingo, 14 Jul 2024' }
  ];
  const variant = variants[index % variants.length];
  return (
    <View style={styles.blockRow}>
      <View style={[styles.blockIcon, { backgroundColor: variant.color }]}>
        <Ionicons name="calendar-outline" size={21} color="#ffffff" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.courtName}>{variant.date}</Text>
        <Text style={styles.bodyCopy}>{court.name}</Text>
        <Text style={styles.bodyCopy}>00:00 - 23:59</Text>
      </View>
      <Text style={[styles.badge, { backgroundColor: variant.color }]}>{variant.title}</Text>
    </View>
  );
}

function ProfileScreen({ session, onLogout }: { session: AuthResponse; onLogout: () => void }) {
  return (
    <View style={styles.page}>
      <View style={styles.profileAvatar}>
        <Ionicons name="person" size={48} color="#ffffff" />
      </View>
      <Text style={styles.successTitle}>{session.fullName}</Text>
      <Text style={styles.centerCopy}>{session.email}</Text>
      <View style={styles.summaryCard}>
        <SummaryRow label="Rol" value={labelRole(session.role)} />
        <SummaryRow label="Estado" value="Activo" />
      </View>
      <Button title="Cerrar sesión" variant="outline" onPress={onLogout} />
    </View>
  );
}

function Field(props: React.ComponentProps<typeof TextInput> & { icon: keyof typeof Ionicons.glyphMap; label: string; error?: string }) {
  const { icon, label, error, style, secureTextEntry, ...rest } = props;
  const [passwordVisible, setPasswordVisible] = useState(false);
  return (
    <View style={styles.fieldGroup}>
      <View style={[styles.field, error && styles.fieldError]}>
      <Ionicons name={icon} size={19} color={error ? '#ff6b6b' : '#9aa4ad'} />
      <View style={styles.fieldBody}>
        <Text style={[styles.fieldLabel, error && styles.fieldLabelError]}>{label}</Text>
        <TextInput
          style={[styles.fieldInput, style]}
          placeholderTextColor="#77808a"
          secureTextEntry={secureTextEntry && !passwordVisible}
          {...rest}
        />
      </View>
      {secureTextEntry && (
        <Pressable
          style={styles.passwordToggle}
          onPress={() => setPasswordVisible((visible) => !visible)}
          accessibilityRole="button"
          accessibilityLabel={passwordVisible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          hitSlop={8}
        >
          <Ionicons name={passwordVisible ? 'eye-off-outline' : 'eye-outline'} size={21} color="#9aa4ad" />
        </Pressable>
      )}
      </View>
      {error && <Text style={styles.fieldErrorText}>{error}</Text>}
    </View>
  );
}

function Button({ title, onPress, disabled, variant = 'solid' }: { title: string; onPress: () => void; disabled?: boolean; variant?: 'solid' | 'outline' }) {
  return (
    <Pressable style={[styles.button, variant === 'outline' && styles.outlineButton, disabled && styles.buttonDisabled]} onPress={onPress} disabled={disabled}>
      <Text style={[styles.buttonText, variant === 'outline' && styles.outlineText]}>{title}</Text>
    </Pressable>
  );
}

function ReservationCard({ reservation }: { reservation: Reservation }) {
  return (
    <View style={styles.reservationCard}>
      <View style={styles.leftAccent} />
      <View style={styles.reservationBody}>
        <Text style={styles.reservationTime}>{relativeDate(reservation.reservationDate)}, {to12Hour(reservation.startTime)}</Text>
        <Text style={styles.reservationCourt}>{reservation.courtName}</Text>
        <Text style={styles.bodyCopy}>{reservation.clientName || 'Partido con amigos'}</Text>
      </View>
      <Text style={[styles.statusPill, reservation.status === 'CONFIRMADA' ? styles.statusOk : styles.statusPending]}>
        {reservation.status === 'PENDIENTE' ? labelPaymentStatus(reservation.paymentStatus) : labelStatus(reservation.status)}
      </Text>
    </View>
  );
}

function EmptyCard({ text }: { text: string }) {
  return (
    <View style={styles.emptyCard}>
      <Ionicons name="calendar-clear-outline" size={28} color="#6f7b84" />
      <Text style={styles.bodyCopy}>{text}</Text>
    </View>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

function BottomTabs({ active, onChange, role }: { active: HomeTab; onChange: (tab: HomeTab) => void; role: Role }) {
  const canManage = role === 'ADMIN' || role === 'PERSONAL';
  const tabs: Array<{ key: HomeTab; icon: keyof typeof Ionicons.glyphMap; label: string }> = [
    { key: 'home', icon: 'home', label: 'Inicio' },
    { key: 'reservations', icon: 'calendar-outline', label: canManage ? 'Agenda' : 'Reservas' },
    { key: 'courts', icon: 'football-outline', label: 'Canchas' },
    ...(role === 'ADMIN' ? [{ key: 'admin' as HomeTab, icon: 'settings' as keyof typeof Ionicons.glyphMap, label: 'Gestion' }] : []),
    { key: 'profile', icon: 'person', label: 'Perfil' }
  ];

  return (
    <View style={styles.tabs}>
      {tabs.map((tab) => (
        <Pressable key={tab.key} style={styles.tabButton} onPress={() => onChange(tab.key)}>
          <Ionicons name={tab.icon} size={22} color={active === tab.key ? '#58c83c' : '#98a2aa'} />
          <Text style={[styles.tabText, active === tab.key && styles.tabActive]}>{tab.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Centered({ text }: { text: string }) {
  return (
    <SafeAreaView style={styles.centered}>
      <ActivityIndicator color="#58c83c" />
      <Text style={styles.bodyCopy}>{text}</Text>
    </SafeAreaView>
  );
}

function labelRole(role: Role) {
  return role === 'ADMIN' ? 'Administrador' : role === 'PERSONAL' ? 'Personal' : 'Cliente';
}

function labelStatus(status: Reservation['status']) {
  return status === 'CONFIRMADA' ? 'Confirmada' : status === 'PENDIENTE' ? 'Pendiente' : status === 'CANCELADA' ? 'Cancelada' : 'Finalizada';
}

function labelPaymentStatus(status: Reservation['paymentStatus']) {
  const labels: Record<Reservation['paymentStatus'], string> = {
    PENDIENTE_PAGO: 'Pendiente de pago',
    EN_REVISION: 'En revision',
    PAGO_EN_LOCAL: 'Pago en local',
    RECHAZADO: 'Pago rechazado',
    PAGADO: 'Pagado'
  };
  return labels[status] ?? 'Pendiente de pago';
}

function labelCourtType(type: Court['type']) {
  const labels: Record<Court['type'], string> = {
    GRASS_SINTETICO: 'Grass sintetico',
    GRASS_NATURAL: 'Grass natural',
    FUTBOL_5: 'Futbol 5',
    FUTBOL_7: 'Futbol 7',
    FUTBOL_11: 'Futbol 11',
    VOLEY: 'Voley',
    OTRO: 'Otro'
  };
  return labels[type] ?? 'Grass sintetico';
}

function labelCourtStatus(status: Court['status']) {
  return status === 'DISPONIBLE' ? 'Disponible' : status === 'MANTENIMIENTO' ? 'Mantenimiento' : 'No disponible';
}

function statusStyle(status: Court['status']) {
  if (status === 'DISPONIBLE') return styles.badgeOk;
  if (status === 'MANTENIMIENTO') return styles.badgeWarn;
  return styles.badgeOff;
}

function firstName(name: string) {
  return name.split(' ')[0] || 'jugador';
}

function formatMoney(value: number) {
  return Number(value).toFixed(2);
}

function addHour(time: string) {
  const [hour] = time.split(':').map(Number);
  return `${String(hour + 1).padStart(2, '0')}:00`;
}

function to12Hour(time: string) {
  const [hour, minutes] = time.split(':');
  const numericHour = Number(hour);
  const displayHour = numericHour > 12 ? numericHour - 12 : numericHour;
  return `${displayHour}:${minutes} ${numericHour >= 12 ? 'PM' : 'AM'}`;
}

function secondsUntil(value?: string) {
  if (!value) return 0;
  return Math.max(0, Math.floor((new Date(value).getTime() - Date.now()) / 1000));
}

function formatCountdown(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function toNineDigits(value: string) {
  return value.replace(/\D/g, '').slice(0, 9);
}

function normalizeWhatsappPhone(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits.length === 9 ? `51${digits}` : digits;
}

function relativeDate(date: string) {
  return date === todayIso ? 'Hoy' : date;
}

const dateOptions = Array.from({ length: 7 }, (_, index) => {
  const date = new Date(`${todayIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + index);
  const iso = date.toISOString().slice(0, 10);
  const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const longDays = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  return {
    iso,
    dayName: dayNames[date.getUTCDay()],
    day: String(date.getUTCDate()),
    month: monthNames[date.getUTCMonth()],
    longLabel: `${longDays[date.getUTCDay()]}, ${date.getUTCDate()} de ${monthNames[date.getUTCMonth()]}`
  };
});

const managementDateOptions = Array.from({ length: 31 }, (_, index) => {
  const date = new Date(`${todayIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + index);
  const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  return {
    iso: date.toISOString().slice(0, 10),
    dayName: dayNames[date.getUTCDay()],
    day: String(date.getUTCDate()),
    month: monthNames[date.getUTCMonth()]
  };
});
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#020b0d' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#020b0d' },
  welcome: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', padding: 24 },
  fillImage: { opacity: 0.72 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 10, 12, 0.58)' },
  brandMark: { width: 96, height: 96, borderRadius: 48, borderWidth: 2, borderColor: '#58c83c', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0, 8, 10, 0.72)' },
  logoText: { marginTop: 20, color: '#ffffff', fontSize: 34, fontWeight: '900', letterSpacing: 0 },
  greenText: { color: '#58c83c' },
  welcomeCopy: { color: '#ffffff', fontSize: 16, lineHeight: 23, textAlign: 'center', marginTop: 8, maxWidth: 230 },
  welcomeActions: { width: '100%', gap: 12, marginTop: 76, marginBottom: 28 },
  authScreen: { flexGrow: 1, padding: 24, gap: 12, backgroundColor: '#020b0d' },
  backButton: { width: 44, height: 44, justifyContent: 'center', marginBottom: 12 },
  authTitle: { color: '#ffffff', fontSize: 28, fontWeight: '900', marginTop: 8 },
  authSub: { color: '#c6ced4', fontSize: 14, marginBottom: 18 },
  fieldGroup: { gap: 5 },
  field: { minHeight: 58, borderWidth: 1, borderColor: '#1f3236', borderRadius: 8, paddingHorizontal: 14, backgroundColor: 'rgba(11, 23, 26, 0.95)', flexDirection: 'row', alignItems: 'center', gap: 12 },
  fieldError: { borderColor: '#ff6b6b' },
  fieldLabelError: { color: '#ff8a8a' },
  fieldErrorText: { color: '#ff8a8a', fontSize: 12, lineHeight: 16, paddingHorizontal: 4 },
  authFieldHint: { color: '#829097', fontSize: 11, lineHeight: 15, paddingHorizontal: 4, marginTop: -3 },
  fieldBody: { flex: 1 },
  fieldLabel: { color: '#c5cdd3', fontSize: 11, fontWeight: '700' },
  fieldInput: { color: '#ffffff', fontSize: 14, paddingVertical: 3 },
  passwordToggle: { minWidth: 36, minHeight: 42, alignItems: 'center', justifyContent: 'center' },
  loginOptions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 4 },
  remember: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  muted: { color: '#a7b0b6', fontSize: 13 },
  greenLink: { color: '#58c83c', fontWeight: '800' },
  mutedCenter: { color: '#c8d0d5', textAlign: 'center', marginTop: 10 },
  forgotIcon: { width: 90, height: 90, borderRadius: 45, borderWidth: 1, borderColor: '#58c83c', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginVertical: 26 },
  centerCopy: { color: '#d9e0e3', fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 18 },
  button: { minHeight: 54, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#36b833', marginTop: 6 },
  outlineButton: { backgroundColor: 'rgba(0, 0, 0, 0.2)', borderWidth: 1, borderColor: '#ffffff' },
  buttonDisabled: { opacity: 0.55 },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '900' },
  outlineText: { color: '#ffffff' },
  appShell: { flex: 1, backgroundColor: '#020b0d' },
  page: { flexGrow: 1, padding: 22, paddingBottom: 104, backgroundColor: '#020b0d' },
  clientHomePage: { flexGrow: 1, padding: 20, paddingBottom: 112, backgroundColor: '#020b0d' },
  clientHomeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  clientWelcome: { color: '#ffffff', fontSize: 25, fontWeight: '900' },
  clientLocationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 },
  clientLocation: { color: '#879499', fontSize: 12 },
  clientHeroCard: { minHeight: 174, borderRadius: 18, backgroundColor: '#0d2718', borderWidth: 1, borderColor: '#20552b', padding: 19, flexDirection: 'row', alignItems: 'center', overflow: 'hidden', marginBottom: 8 },
  clientHeroCopy: { flex: 1, paddingRight: 8 },
  clientHeroTitle: { color: '#ffffff', fontSize: 22, lineHeight: 27, fontWeight: '900' },
  clientHeroText: { color: '#a9b8b0', fontSize: 12, lineHeight: 18, marginTop: 7, marginBottom: 14 },
  clientReserveButton: { alignSelf: 'flex-start', minHeight: 43, borderRadius: 10, paddingHorizontal: 14, backgroundColor: '#36b833', flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center' },
  clientReservationCard: { minHeight: 104, borderRadius: 13, backgroundColor: '#081719', borderWidth: 1, borderColor: '#1a3035', padding: 13, flexDirection: 'row', alignItems: 'center' },
  clientReservationDate: { width: 82, alignItems: 'center', justifyContent: 'center', borderRightWidth: 1, borderRightColor: '#203439', paddingRight: 10 },
  clientReservationDay: { color: '#d8e0e2', fontSize: 11, marginTop: 6, textAlign: 'center' },
  clientReservationInfo: { flex: 1, paddingHorizontal: 13 },
  clientReservationCourt: { color: '#ffffff', fontSize: 16, fontWeight: '900' },
  clientReservationTime: { color: '#c3cdcf', fontSize: 13, marginTop: 5 },
  clientPaymentStatus: { color: '#e3a63b', fontSize: 11, fontWeight: '800', marginTop: 5 },
  clientAvailabilityRow: { gap: 11, paddingRight: 20 },
  clientAvailabilityCard: { width: 188, borderRadius: 13, backgroundColor: '#081719', borderWidth: 1, borderColor: '#1a3035', padding: 11 },
  clientAvailabilityImage: { width: '100%', height: 82, borderRadius: 9, marginBottom: 10, backgroundColor: '#132529' },
  clientAvailabilityCourt: { color: '#ffffff', fontSize: 15, fontWeight: '900' },
  clientAvailabilityTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 7 },
  clientAvailabilityTime: { color: '#dbe3e4', fontSize: 13, fontWeight: '800' },
  clientAvailabilityPrice: { color: '#89979b', fontSize: 11, marginTop: 5 },
  clientAvailabilityAction: { color: '#58c83c', fontWeight: '900', marginTop: 10 },
  managedPage: { flexGrow: 1, padding: 20, paddingBottom: 112, backgroundColor: '#020b0d' },
  managedLoading: { flex: 1, backgroundColor: '#020b0d', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 30 },
  managedError: { color: '#dce3e5', textAlign: 'center', lineHeight: 21 },
  managedHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  managedEyebrow: { color: '#58c83c', fontSize: 11, fontWeight: '900', letterSpacing: 1.1, marginBottom: 5 },
  managedTitle: { color: '#ffffff', fontSize: 25, fontWeight: '900' },
  managedDate: { color: '#829095', marginTop: 4 },
  refreshButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#102125', alignItems: 'center', justifyContent: 'center' },
  primaryAction: { backgroundColor: '#36b833', borderRadius: 10, minWidth: 130, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  quickActions: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  quickPrimary: { flex: 1, minHeight: 54, borderRadius: 12, backgroundColor: '#36b833', flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  quickSecondary: { flex: 1, minHeight: 54, borderRadius: 12, backgroundColor: '#0a1719', borderWidth: 1, borderColor: '#294044', flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  quickActionText: { color: '#ffffff', fontWeight: '900' },
  quickSecondaryText: { color: '#dce5e6', fontWeight: '900' },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 10 },
  operationMetric: { width: '48.5%', minHeight: 118, backgroundColor: '#081719', borderRadius: 13, borderWidth: 1, borderColor: '#172b30', padding: 14 },
  metricIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  metricValue: { color: '#ffffff', fontSize: 21, fontWeight: '900' },
  metricLabel: { color: '#8e9b9f', fontSize: 12, marginTop: 3 },
  operationCourtCard: { minHeight: 84, flexDirection: 'row', alignItems: 'center', backgroundColor: '#081719', borderRadius: 12, borderWidth: 1, borderColor: '#182c31', overflow: 'hidden', marginBottom: 9, paddingRight: 13 },
  operationStatusBar: { width: 5, alignSelf: 'stretch', marginRight: 13 },
  operationFree: { backgroundColor: '#58c83c' },
  operationBusy: { backgroundColor: '#e64c43' },
  operationWarning: { backgroundColor: '#e3a63b' },
  operationCourtBody: { flex: 1, paddingVertical: 12 },
  operationCourtHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 },
  operationCourtName: { color: '#ffffff', fontSize: 15, fontWeight: '900' },
  operationStatusText: { color: '#e3a63b', fontSize: 10, fontWeight: '900' },
  operationClient: { color: '#e8edef', fontWeight: '800' },
  operationTime: { color: '#849297', fontSize: 12, marginTop: 3 },
  upcomingOperationCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#081719', borderRadius: 12, padding: 12, marginBottom: 9, borderWidth: 1, borderColor: '#182c31' },
  upcomingTimeBox: { width: 88, paddingRight: 10 },
  upcomingTime: { color: '#58c83c', fontSize: 14, fontWeight: '900' },
  upcomingCourt: { color: '#819095', fontSize: 10, marginTop: 3 },
  upcomingInfo: { flex: 1, borderLeftWidth: 1, borderLeftColor: '#203439', paddingLeft: 12 },
  whatsappMiniButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#20a85a', alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  pageFixed: { flex: 1, padding: 20, paddingBottom: 92, backgroundColor: '#020b0d' },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 },
  location: { color: '#ffffff', fontWeight: '800' },
  hello: { color: '#ffffff', fontSize: 24, fontWeight: '900' },
  bodyCopy: { color: '#b8c1c7', fontSize: 14, lineHeight: 20 },
  sectionHeader: { marginTop: 24, marginBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: '#ffffff', fontSize: 16, fontWeight: '900', marginTop: 18, marginBottom: 12 },
  timeCard: { width: 106, minHeight: 76, borderRadius: 8, backgroundColor: '#081719', borderWidth: 1, borderColor: '#152a2f', padding: 12, marginRight: 10, justifyContent: 'center' },
  cardTitle: { color: '#ffffff', fontWeight: '900', marginBottom: 8 },
  timeText: { color: '#ffffff', fontSize: 17, fontWeight: '900' },
  reservationCard: { minHeight: 116, borderRadius: 8, backgroundColor: '#081719', borderWidth: 1, borderColor: '#1a3035', padding: 14, marginBottom: 12, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  leftAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: '#58c83c' },
  reservationBody: { flex: 1, paddingLeft: 8 },
  reservationTime: { color: '#ffffff', fontSize: 16, fontWeight: '900' },
  reservationCourt: { color: '#ffffff', fontSize: 18, fontWeight: '900', marginTop: 4 },
  statusPill: { overflow: 'hidden', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 7, color: '#071315', fontWeight: '900', fontSize: 12 },
  statusOk: { backgroundColor: '#58c83c' },
  statusPending: { backgroundColor: '#d7b51f' },
  navTitle: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navText: { color: '#ffffff', fontSize: 17, fontWeight: '900' },
  courtList: { paddingTop: 8, paddingBottom: 16 },
  courtRow: { minHeight: 104, borderRadius: 8, borderWidth: 1, borderColor: '#182f33', backgroundColor: '#081719', padding: 9, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  courtThumb: { width: 118, height: 84, borderRadius: 7 },
  courtInfo: { flex: 1 },
  courtName: { color: '#ffffff', fontSize: 17, fontWeight: '900' },
  courtDesc: { color: '#aab3b9', marginTop: 3, marginBottom: 8 },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  badge: { overflow: 'hidden', borderRadius: 5, paddingHorizontal: 8, paddingVertical: 5, color: '#ffffff', fontSize: 12, fontWeight: '900' },
  badgeOk: { backgroundColor: '#259a2d' },
  badgeWarn: { backgroundColor: '#8a6d16' },
  badgeOff: { backgroundColor: '#b72d2d' },
  price: { color: '#ffffff', fontSize: 12, fontWeight: '800' },
  detailScreen: { flex: 1, backgroundColor: '#020b0d' },
  detailContent: { paddingBottom: 28 },
  detailHero: { height: 245, justifyContent: 'flex-end' },
  detailHeroImage: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  heroShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 8, 10, 0.28)' },
  backOverlay: { position: 'absolute', top: 24, left: 18, width: 42, height: 42, justifyContent: 'center' },
  heroTitleWrap: { padding: 20 },
  detailTitle: { color: '#ffffff', fontSize: 30, fontWeight: '900' },
  detailSub: { color: '#dce4e8', fontSize: 16 },
  detailPrice: { color: '#ffffff', fontSize: 22, fontWeight: '900', paddingHorizontal: 20, marginTop: 18 },
  priceUnit: { fontSize: 14, color: '#d7dfe3' },
  dateRow: { paddingHorizontal: 20 },
  reservationFilters: { gap: 9, marginTop: 8, marginBottom: 8 },
  managementFilterChip: { minWidth: 104, minHeight: 44, borderRadius: 9, borderWidth: 1, borderColor: '#1d363b', backgroundColor: '#081719', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginRight: 9 },
  managementFilterChipActive: { borderColor: '#58c83c', backgroundColor: '#102916' },
  managementFilterText: { color: '#aeb8bf', fontSize: 13, fontWeight: '700' },
  datePill: { width: 62, height: 78, borderRadius: 8, borderWidth: 1, borderColor: '#193136', backgroundColor: '#081719', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  datePillActive: { backgroundColor: '#36b833', borderColor: '#36b833' },
  dateDow: { color: '#c2cbd1', fontSize: 13, fontWeight: '800' },
  dateDay: { color: '#ffffff', fontSize: 20, fontWeight: '900' },
  dateMonth: { color: '#c2cbd1', fontSize: 13, fontWeight: '800' },
  activeText: { color: '#ffffff' },
  timeGrid: { paddingHorizontal: 20, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  slot: { width: '30.5%', minHeight: 58, borderRadius: 8, borderWidth: 1, borderColor: '#1a3035', backgroundColor: '#081719', alignItems: 'center', justifyContent: 'center' },
  slotDisabled: { opacity: 0.45, backgroundColor: '#182124' },
  slotTextDisabled: { color: '#7f898f' },
  slotReserved: { minHeight: 64, backgroundColor: '#6f1717', borderColor: '#ff5148' },
  slotActive: { backgroundColor: '#36b833', borderColor: '#36b833' },
  slotText: { color: '#ffffff', fontWeight: '900', textAlign: 'center', fontSize: 12 },
  durationRow: { paddingHorizontal: 20, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  durationOption: { width: '30.5%', minHeight: 52, borderRadius: 9, borderWidth: 1, borderColor: '#264047', backgroundColor: '#081719', alignItems: 'center', justifyContent: 'center' },
  durationOptionActive: { backgroundColor: '#36b833', borderColor: '#36b833' },
  durationOptionDisabled: { opacity: 0.35 },
  durationOptionText: { color: '#ffffff', fontWeight: '800' },
  priceBreakdownCard: { marginHorizontal: 20, marginBottom: 18, padding: 15, borderRadius: 12, backgroundColor: '#0a1719', borderWidth: 1, borderColor: '#203437' },
  priceBreakdownTitle: { color: '#ffffff', fontSize: 15, fontWeight: '900', marginBottom: 10 },
  priceBreakdownRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  priceBreakdownLabel: { color: '#aebbbb', fontSize: 13 },
  priceBreakdownAmount: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  priceTotalRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 9, paddingTop: 11, borderTopWidth: 1, borderTopColor: '#294044' },
  priceTotalLabel: { color: '#ffffff', fontWeight: '800' },
  priceTotalAmount: { color: '#58c83c', fontSize: 18, fontWeight: '900' },
  selectionSummary: { color: '#cbd4d8', textAlign: 'center', marginTop: 11, marginBottom: 4, fontWeight: '700' },
  successScreen: { flexGrow: 1, padding: 24, justifyContent: 'center', backgroundColor: '#020b0d' },
  successCircle: { width: 96, height: 96, borderRadius: 48, backgroundColor: '#58c83c', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 20 },
  successTitle: { color: '#ffffff', fontSize: 26, fontWeight: '900', textAlign: 'center', marginBottom: 8 },
  countdownCard: { borderWidth: 1, borderColor: '#8a6d16', backgroundColor: '#081719', borderRadius: 8, padding: 16, alignItems: 'center', marginBottom: 14 },
  countdownText: { color: '#d7ff45', fontSize: 32, fontWeight: '900', marginTop: 4 },
  paymentBox: { borderWidth: 1, borderColor: '#1d363b', backgroundColor: '#081719', borderRadius: 8, padding: 16, marginBottom: 14 },
  qrRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  qrItem: { flex: 1, alignItems: 'center', gap: 8 },
  qrImage: { width: 128, height: 128, borderRadius: 8, backgroundColor: '#ffffff' },
  userManagementCard: { borderWidth: 1, borderColor: '#1d363b', backgroundColor: '#081719', borderRadius: 12, padding: 14, flexDirection: 'row', gap: 13, marginBottom: 10 },
  userAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#35c62f', alignItems: 'center', justifyContent: 'center' },
  userAvatarDisabled: { backgroundColor: '#536067' },
  userManagementInfo: { flex: 1, gap: 3 },
  userBadges: { flexDirection: 'row', gap: 7, marginTop: 7 },
  userActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 14, marginTop: 11, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#173035' },
  userRoleSelector: { flexDirection: 'row', gap: 10, marginTop: 7 },
  userRoleOption: { flex: 1, minHeight: 112, borderWidth: 1, borderColor: '#244047', borderRadius: 10, padding: 12, justifyContent: 'center', gap: 6 },
  userRoleOptionActive: { borderColor: '#58c83c', backgroundColor: '#102916' },  paymentPreview: { borderWidth: 1, borderColor: '#1d363b', backgroundColor: '#081719', borderRadius: 8, padding: 14, marginTop: 14, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 14 },
  qrUploadArea: { minHeight: 104, borderWidth: 1, borderStyle: 'dashed', borderColor: '#31535a', backgroundColor: '#061113', borderRadius: 12, padding: 12, marginTop: 7, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  qrUploadPreview: { width: 78, height: 78, borderRadius: 9, backgroundColor: '#ffffff' },
  qrUploadPlaceholder: { width: 78, height: 78, borderRadius: 9, borderWidth: 1, borderColor: '#244047', backgroundColor: '#0a1b1e', alignItems: 'center', justifyContent: 'center' },
  qrUploadInfo: { flex: 1 },
  summaryCard: { borderWidth: 1, borderColor: '#1d363b', backgroundColor: '#081719', borderRadius: 8, padding: 16, marginVertical: 16 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 18, paddingVertical: 8 },
  summaryLabel: { color: '#aab3b9', flex: 1 },
  summaryValue: { color: '#ffffff', fontWeight: '900', flex: 1.2, textAlign: 'right' },
  reservationFullCard: { marginBottom: 12 },
  restoreReservationButton: { minHeight: 44, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, backgroundColor: '#2479a8', flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: -4 },
  cancelledReservationActions: { flexDirection: 'row', gap: 7, marginTop: -4 },
  historyButton: { width: 48, minHeight: 44, borderRadius: 9, backgroundColor: '#34474c', alignItems: 'center', justifyContent: 'center' },
  infoLink: { color: '#65aee0', fontWeight: '800' },
  historyModal: { width: '92%', maxHeight: '82%', borderRadius: 18, backgroundColor: '#071214', borderWidth: 1, borderColor: '#20363a', padding: 18 },
  historyEntry: { flexDirection: 'row', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#192d31' },
  historyDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#58c83c', marginTop: 5, marginRight: 11 },
  historyEntryBody: { flex: 1 },
  historyAction: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  historyActor: { color: '#819095', fontSize: 11, marginTop: 4 },
  historyChange: { color: '#c7d0d2', fontSize: 12, marginTop: 5 },
  historyReason: { color: '#e0aa4e', fontSize: 11, marginTop: 5 },
  clientPayButton: { minHeight: 44, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, backgroundColor: '#36b833', flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: -4 },
  paymentDetailsModal: { width: '92%', maxHeight: '90%', borderRadius: 18, backgroundColor: '#071214', borderWidth: 1, borderColor: '#20363a', padding: 18 },
  paymentModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  modalCloseButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#132428', alignItems: 'center', justifyContent: 'center' },
  paymentModalQr: { alignSelf: 'center', width: 210, height: 210, marginBottom: 14 },
  dangerCenter: { color: '#ee6a61', textAlign: 'center', marginTop: 11, fontWeight: '800' },
  adminActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 18, paddingRight: 8 },
  danger: { color: '#ff625c', fontWeight: '900' },
  adminCard: { borderWidth: 1, borderColor: '#1d363b', backgroundColor: '#081719', borderRadius: 8, padding: 14, marginTop: 12, gap: 10 },
  adminInputWrap: { flex: 1, gap: 5 },
  adminInput: { minHeight: 46, borderRadius: 8, borderWidth: 1, borderColor: '#263a3f', backgroundColor: '#061214', color: '#ffffff', paddingHorizontal: 12, paddingVertical: 9 },
  twoCols: { flexDirection: 'row', gap: 10 },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { borderRadius: 8, borderWidth: 1, borderColor: '#263a3f', paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#061214' },
  choiceActive: { borderColor: '#58c83c', backgroundColor: '#12351c' },
  choiceText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },
  adminCourtRow: { borderWidth: 1, borderColor: '#1d363b', backgroundColor: '#081719', borderRadius: 8, padding: 12, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  adminCourtMain: { flex: 1 },
  adminMiniActions: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  adminTop: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  addSquare: { width: 36, height: 36, borderRadius: 8, backgroundColor: '#42bd2d', alignItems: 'center', justifyContent: 'center' },
  headerSpacer: { width: 36, height: 36 },
  searchRow: { flexDirection: 'row', gap: 10, marginTop: 16, marginBottom: 8 },
  searchBox: { flex: 1, minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: '#1d363b', backgroundColor: '#081719', paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  userSearchBox: { width: '100%', height: 48, maxHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: '#1d363b', backgroundColor: '#081719', paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, marginBottom: 6 },
  searchInput: { flex: 1, color: '#ffffff' },
  filterButton: { width: 48, borderRadius: 8, backgroundColor: '#081719', borderWidth: 1, borderColor: '#1d363b', alignItems: 'center', justifyContent: 'center' },
  managementRow: { minHeight: 92, borderRadius: 8, borderWidth: 1, borderColor: '#182f33', backgroundColor: '#081719', padding: 9, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  managementThumb: { width: 88, height: 62, borderRadius: 7 },
  managementSide: { alignItems: 'flex-end', justifyContent: 'space-between', minHeight: 62 },
  photoStrip: { flexDirection: 'row', gap: 8, marginTop: 14 },
  photoPlaceholder: { flex: 1, height: 96, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: '#385057', backgroundColor: '#061214', alignItems: 'center', justifyContent: 'center', gap: 8 },
  photoPreview: { flex: 1, height: 96, borderRadius: 8 },
  segmentTabs: { minHeight: 58, borderRadius: 8, backgroundColor: '#081719', borderWidth: 1, borderColor: '#10252a', flexDirection: 'row', alignItems: 'center', padding: 4, marginTop: 10 },
  segmentTab: { flex: 1, color: '#c8d0d5', textAlign: 'center', fontWeight: '800', paddingVertical: 14, borderRadius: 7, fontSize: 12 },
  segmentTabActive: { color: '#58c83c', backgroundColor: '#102916', borderBottomWidth: 2, borderBottomColor: '#58c83c' },
  selectLine: { minHeight: 58, borderRadius: 8, borderWidth: 1, borderColor: '#263a3f', backgroundColor: '#061214', paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  timePickerButton: { minHeight: 54, borderRadius: 8, borderWidth: 1, borderColor: '#263a3f', backgroundColor: '#061214', paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.72)', alignItems: 'center', justifyContent: 'center', padding: 22 },
  timePickerModal: { width: '100%', maxHeight: '76%', borderRadius: 12, borderWidth: 1, borderColor: '#244047', backgroundColor: '#071315', padding: 18 },
  saveConfirmationModal: { width: '100%', maxWidth: 390, borderRadius: 22, borderWidth: 1, borderColor: '#244047', backgroundColor: '#071315', padding: 22, alignItems: 'center' },
  saveSuccessIcon: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: '#35c62f', marginTop: -4, marginBottom: 14, shadowColor: '#35c62f', shadowOpacity: 0.32, shadowRadius: 12, elevation: 7 },
  saveConfirmationEyebrow: { color: '#58c83c', fontSize: 11, fontWeight: '800', letterSpacing: 1.1, marginBottom: 7 },
  saveConfirmationTitle: { color: '#ffffff', fontSize: 24, fontWeight: '800', textAlign: 'center' },
  saveConfirmationCopy: { color: '#aeb8bf', fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 7, marginBottom: 18 },
  saveSummaryCard: { width: '100%', borderRadius: 14, borderWidth: 1, borderColor: '#1d353a', backgroundColor: '#0a1b1e', paddingHorizontal: 15, paddingVertical: 4 },
  saveSummaryRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  saveSummaryText: { flex: 1, marginLeft: 12 },
  saveSummaryLabel: { color: '#819097', fontSize: 12, marginBottom: 3 },
  saveSummaryValue: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  saveSummaryDivider: { height: 1, backgroundColor: '#183034', marginLeft: 33 },
  saveConfirmationButton: { width: '100%', minHeight: 50, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#35c62f', marginTop: 18 },
  saveConfirmationButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  timePickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hourGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingBottom: 8 },
  hourOption: { width: '30.5%', minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: '#263a3f', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b1d20' },
  hourOptionActive: { backgroundColor: '#36b833', borderColor: '#36b833' },
  hourOptionText: { color: '#ffffff', fontWeight: '800' },  selectValue: { color: '#ffffff', fontSize: 15, fontWeight: '700', marginTop: 4 },
  tariffRow: { minHeight: 82, borderTopWidth: 1, borderTopColor: '#1d363b', flexDirection: 'row', alignItems: 'center', gap: 12 },
  tariffTime: { color: '#ffffff', fontSize: 16, fontWeight: '900' },
  iconBox: { width: 38, height: 38, borderRadius: 8, borderWidth: 1, borderColor: '#263a3f', backgroundColor: '#061214', alignItems: 'center', justifyContent: 'center' },
  infoCard: { borderWidth: 1, borderColor: '#1d363b', backgroundColor: '#081719', borderRadius: 8, padding: 16, marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  dayGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 16 },
  dayChip: { overflow: 'hidden', borderRadius: 8, backgroundColor: '#2f8e21', color: '#ffffff', fontWeight: '900', paddingHorizontal: 12, paddingVertical: 12 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  switchOn: { width: 52, height: 30, borderRadius: 15, backgroundColor: '#58c83c', padding: 3, alignItems: 'flex-end' },
  switchDot: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#ffffff' },
  adminDetailHero: { height: 180, justifyContent: 'flex-end' },
  pageInner: { padding: 20, paddingBottom: 28 },
  imageCounter: { position: 'absolute', right: 18, bottom: 12, color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4, fontWeight: '900' },
  featureGrid: { flexDirection: 'row', marginTop: 18, marginBottom: 14 },
  featureBox: { flex: 1, minHeight: 58, borderWidth: 1, borderColor: '#1d363b', backgroundColor: '#081719', alignItems: 'center', justifyContent: 'center', gap: 5, padding: 8 },
  featureValue: { color: '#ffffff', fontWeight: '900', fontSize: 12 },
  featureList: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 18 },
  featureBullet: { width: '30%', color: '#c8d0d5', fontSize: 12 },
  calendarNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 16 },
  weekRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 8 },
  weekDay: { color: '#c8d0d5', width: 42, textAlign: 'center', fontWeight: '800' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  calendarDay: { width: '13.4%', aspectRatio: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  calendarDayActive: { backgroundColor: '#58c83c' },
  calendarNumber: { color: '#ffffff', fontWeight: '900' },
  dotRow: { flexDirection: 'row', gap: 3, marginTop: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  legendGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginVertical: 16 },
  legendText: { color: '#c8d0d5', width: '45%', fontSize: 12 },
  blockRow: { minHeight: 92, borderRadius: 8, borderWidth: 1, borderColor: '#182f33', backgroundColor: '#081719', padding: 12, marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  blockIcon: { width: 38, height: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  profileAvatar: { width: 96, height: 96, borderRadius: 48, backgroundColor: '#173337', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginTop: 40, marginBottom: 18 },
  emptyCard: { minHeight: 120, borderRadius: 8, borderWidth: 1, borderColor: '#182f33', backgroundColor: '#081719', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 18 },
  tabs: { position: 'absolute', left: 14, right: 14, bottom: 14, height: 72, borderRadius: 8, backgroundColor: '#071315', borderWidth: 1, borderColor: '#10252a', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  tabButton: { flex: 1, alignItems: 'center', gap: 5 },
  tabText: { color: '#98a2aa', fontSize: 12, fontWeight: '700' },
  tabActive: { color: '#58c83c' }
});
