import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  ImageBackground,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { api, setAuthToken } from './src/api/client';
import { subscribeAvailability } from './src/api/realtime';
import { AuthResponse, Court, Reservation, Role } from './src/types';
import { clearSession, getSession, saveSession } from './src/storage/session';

const today = new Date();
const todayIso = today.toISOString().slice(0, 10);
const heroImage = 'https://images.unsplash.com/photo-1556056504-5c7696c4c28d?auto=format&fit=crop&w=1200&q=80';
const courtImages = [
  'https://images.unsplash.com/photo-1624880357913-a8539238245b?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1606925797300-0b35e9d1794e?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1522778119026-d647f0596c20?auto=format&fit=crop&w=900&q=80'
];

type AuthMode = 'welcome' | 'login' | 'register' | 'forgot';
type HomeTab = 'home' | 'reservations' | 'courts' | 'profile';

type ReservationDraft = {
  court: Court;
  date: string;
  displayDate: string;
  startTime: string;
  endTime: string;
};

export default function App() {
  const [session, setSession] = useState<AuthResponse | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);

  useEffect(() => {
    getSession().then((stored) => {
      if (stored) {
        setAuthToken(stored.token);
        setSession(stored);
      }
      setLoadingSession(false);
    });
  }, []);

  const onAuth = async (auth: AuthResponse) => {
    setAuthToken(auth.token);
    setSession(auth);
    await saveSession(auth);
  };

  const logout = async () => {
    setAuthToken(null);
    setSession(null);
    await clearSession();
  };

  if (loadingSession) {
    return <Centered text="Cargando sesión..." />;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      {session ? <HomeScreen session={session} onLogout={logout} /> : <AuthScreen onAuth={onAuth} />}
    </SafeAreaView>
  );
}

function AuthScreen({ onAuth }: { onAuth: (auth: AuthResponse) => void }) {
  const [mode, setMode] = useState<AuthMode>('welcome');
  const [names, setNames] = useState('');
  const [lastNames, setLastNames] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (mode === 'register' && password !== confirmPassword) {
      Alert.alert('Contraseñas', 'La confirmación no coincide.');
      return;
    }

    try {
      setBusy(true);
      const payload = mode === 'login'
        ? await api<AuthResponse>('/auth/login', { method: 'POST', body: { email, password } })
        : await api<AuthResponse>('/auth/register', {
          method: 'POST',
          body: { fullName: `${names} ${lastNames}`.trim(), email, password, phone }
        });
      onAuth(payload);
    } catch (error) {
      Alert.alert('No se pudo ingresar', error instanceof Error ? error.message : 'Error desconocido');
    } finally {
      setBusy(false);
    }
  };

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
          <Button title="Iniciar sesión" onPress={() => setMode('login')} />
          <Button title="Crear cuenta" variant="outline" onPress={() => setMode('register')} />
          <Pressable style={styles.guestButton} onPress={() => setMode('login')}>
            <Ionicons name="scan-outline" size={18} color="#ffffff" />
            <Text style={styles.guestText}>Explorar como invitado</Text>
          </Pressable>
        </View>
      </ImageBackground>
    );
  }

  if (mode === 'forgot') {
    return (
      <AuthShell onBack={() => setMode('login')}>
        <View style={styles.forgotIcon}>
          <Ionicons name="mail" size={44} color="#ffffff" />
        </View>
        <Text style={styles.authTitle}>Recuperar <Text style={styles.greenText}>contraseña</Text></Text>
        <Text style={styles.centerCopy}>Ingresa tu correo electrónico y te enviaremos un enlace para restablecer tu contraseña.</Text>
        <Field icon="mail-outline" label="Correo electrónico" placeholder="ejemplo@correo.com" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
        <Button title="Enviar enlace" onPress={() => Alert.alert('Recuperación', 'Función lista para conectar con el backend.')} />
        <Pressable onPress={() => setMode('login')}>
          <Text style={styles.mutedCenter}>Volver al inicio de sesión</Text>
        </Pressable>
      </AuthShell>
    );
  }

  return (
    <AuthShell onBack={() => setMode('welcome')}>
      <Text style={styles.authTitle}>
        {mode === 'login' ? 'Bienvenido ' : 'Crear cuenta'}
        {mode === 'login' && <Text style={styles.greenText}>de vuelta</Text>}
      </Text>
      <Text style={styles.authSub}>{mode === 'login' ? 'Inicia sesión para continuar' : 'Únete a ReserGrass'}</Text>

      {mode === 'register' && (
        <>
          <Field icon="person" label="Nombres" placeholder="Hans Martín" value={names} onChangeText={setNames} />
          <Field icon="people-outline" label="Apellidos" placeholder="Matencios Parian" value={lastNames} onChangeText={setLastNames} />
        </>
      )}
      <Field icon="mail-outline" label="Correo electrónico" placeholder="ejemplo@correo.com" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
      {mode === 'register' && <Field icon="phone-portrait-outline" label="Celular" placeholder="987 654 321" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />}
      <Field icon="lock-closed" label="Contraseña" placeholder="••••••••••" value={password} onChangeText={setPassword} secureTextEntry />
      {mode === 'register' && <Field icon="lock-closed-outline" label="Confirmar contraseña" placeholder="••••••••••" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry />}

      {mode === 'login' && (
        <View style={styles.loginOptions}>
          <Pressable style={styles.remember} onPress={() => setRemember(!remember)}>
            <Ionicons name={remember ? 'checkbox' : 'square-outline'} size={20} color="#59c13a" />
            <Text style={styles.muted}>Recordarme</Text>
          </Pressable>
          <Pressable onPress={() => setMode('forgot')}>
            <Text style={styles.greenLink}>¿Olvidaste tu contraseña?</Text>
          </Pressable>
        </View>
      )}

      <Button title={busy ? 'Procesando...' : mode === 'login' ? 'Iniciar sesión' : 'Crear mi cuenta'} onPress={submit} disabled={busy} />

      {mode === 'login' && (
        <>
          <Text style={styles.separator}>—  o continuar con  —</Text>
          <View style={styles.socialRow}>
            <SocialButton name="logo-google" text="Google" />
            <SocialButton name="logo-facebook" text="Facebook" />
          </View>
        </>
      )}

      <Pressable onPress={() => setMode(mode === 'login' ? 'register' : 'login')}>
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
    if (!courtId) return;
    try {
      const data = await api<Reservation[]>(`/reservations?courtId=${courtId}&date=${todayIso}`);
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
      {tab === 'home' && <Dashboard session={session} courts={courts} reservations={reservations} openCourt={openCourt} />}
      {tab === 'reservations' && <ReservationsScreen reservations={reservations} canManage={canManage} refresh={loadReservations} />}
      {tab === 'courts' && <CourtsScreen courts={courts} openCourt={openCourt} />}
      {tab === 'profile' && <ProfileScreen session={session} onLogout={onLogout} />}
      <BottomTabs active={tab} onChange={setTab} />
    </View>
  );
}

function Dashboard({ session, courts, reservations, openCourt }: { session: AuthResponse; courts: Court[]; reservations: Reservation[]; openCourt: (court: Court) => void }) {
  const upcoming = reservations.slice(0, 2);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.topBar}>
        <Ionicons name="menu" size={28} color="#ffffff" />
        <Text style={styles.location}>Huancayo, Perú</Text>
        <Ionicons name="notifications-outline" size={24} color="#ffffff" />
      </View>
      <Text style={styles.hello}>¡Hola, {firstName(session.fullName)}!</Text>
      <Text style={styles.bodyCopy}>¿Listo para reservar tu cancha?</Text>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Próximos horarios disponibles</Text>
        <Text style={styles.greenLink}>Ver todos</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {courts.slice(0, 4).map((court, index) => (
          <Pressable key={court.id} style={styles.timeCard} onPress={() => openCourt(court)}>
            <Text style={styles.cardTitle}>{court.name}</Text>
            <Text style={styles.timeText}>{7 + index}:00 <Text style={styles.greenText}>PM</Text></Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Mis próximas reservas</Text>
        <Text style={styles.greenLink}>Ver todas</Text>
      </View>
      {upcoming.length === 0 ? (
        <EmptyCard text="Aún no tienes reservas para hoy." />
      ) : upcoming.map((item) => <ReservationCard key={item.id} reservation={item} />)}
    </ScrollView>
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

function CourtDetailScreen({ court, onBack, onReserved }: { court: Court; onBack: () => void; onReserved: (draft: ReservationDraft) => void }) {
  const [dateIndex, setDateIndex] = useState(0);
  const [time, setTime] = useState('19:00');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeAvailability(court.id, dateOptions[dateIndex].iso, () => undefined);
    return () => {
      unsubscribe();
    };
  }, [court.id, dateIndex]);

  const reserve = async () => {
    const endTime = addHour(time);
    const selectedDate = dateOptions[dateIndex];

    try {
      setBusy(true);
      await api<Reservation>('/reservations', {
        method: 'POST',
        body: { courtId: court.id, reservationDate: selectedDate.iso, startTime: time, endTime }
      });
      onReserved({ court, date: selectedDate.iso, displayDate: selectedDate.longLabel, startTime: time, endTime });
    } catch (error) {
      Alert.alert('No se pudo reservar', error instanceof Error ? error.message : 'Error desconocido');
    } finally {
      setBusy(false);
    }
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
      <View style={styles.timeGrid}>
        {['18:00', '19:00', '20:00', '21:00', '22:00', '23:00'].map((item) => (
          <Pressable key={item} style={[styles.slot, item === time && styles.slotActive]} onPress={() => setTime(item)}>
            <Text style={[styles.slotText, item === time && styles.activeText]}>{to12Hour(item)}</Text>
          </Pressable>
        ))}
      </View>
      <Button title={busy ? 'Reservando...' : 'Reservar ahora'} onPress={reserve} disabled={busy || !court.active} />
    </ScrollView>
  );
}

function SuccessScreen({ draft, onHome, onReservations }: { draft: ReservationDraft; onHome: () => void; onReservations: () => void }) {
  return (
    <View style={styles.successScreen}>
      <View style={styles.successCircle}>
        <Ionicons name="checkmark" size={72} color="#ffffff" />
      </View>
      <Text style={styles.successTitle}>¡Reserva confirmada!</Text>
      <Text style={styles.centerCopy}>Tu reserva se ha realizado correctamente.</Text>
      <View style={styles.summaryCard}>
        <SummaryRow label="Cancha" value={draft.court.name} />
        <SummaryRow label="Fecha" value={draft.displayDate} />
        <SummaryRow label="Hora" value={`${to12Hour(draft.startTime)} - ${to12Hour(draft.endTime)}`} />
        <SummaryRow label="Precio" value={`S/ ${formatMoney(draft.court.hourlyPrice)}`} />
        <SummaryRow label="Método de pago" value="Yape" />
      </View>
      <Button title="Ver mis reservas" onPress={onReservations} />
      <Pressable onPress={onHome}>
        <Text style={styles.mutedCenter}>Volver al inicio</Text>
      </Pressable>
    </View>
  );
}

function ReservationsScreen({ reservations, canManage, refresh }: { reservations: Reservation[]; canManage: boolean; refresh: () => void }) {
  const updateStatus = async (reservationId: number, status: string) => {
    await api<Reservation>(`/reservations/${reservationId}/status?status=${status}`, { method: 'PATCH' });
    await refresh();
  };

  return (
    <View style={styles.pageFixed}>
      <View style={styles.navTitle}>
        <Text style={styles.navText}>Mis reservas</Text>
        <Ionicons name="calendar-outline" size={24} color="#ffffff" />
      </View>
      <FlatList
        data={reservations}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.courtList}
        ListEmptyComponent={<EmptyCard text="No hay reservas para esta fecha." />}
        renderItem={({ item }) => (
          <View style={styles.reservationFullCard}>
            <ReservationCard reservation={item} />
            {canManage && item.status !== 'CANCELADA' && (
              <View style={styles.adminActions}>
                <Pressable onPress={() => updateStatus(item.id, 'CONFIRMADA')}><Text style={styles.greenLink}>Confirmar</Text></Pressable>
                <Pressable onPress={() => updateStatus(item.id, 'CANCELADA')}><Text style={styles.danger}>Cancelar</Text></Pressable>
              </View>
            )}
          </View>
        )}
      />
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

function Field(props: React.ComponentProps<typeof TextInput> & { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  const { icon, label, style, ...rest } = props;
  return (
    <View style={styles.field}>
      <Ionicons name={icon} size={19} color="#9aa4ad" />
      <View style={styles.fieldBody}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <TextInput style={[styles.fieldInput, style]} placeholderTextColor="#77808a" {...rest} />
      </View>
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

function SocialButton({ name, text }: { name: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <Pressable style={styles.socialButton}>
      <Ionicons name={name} size={22} color={text === 'Facebook' ? '#1877f2' : '#ffffff'} />
      <Text style={styles.socialText}>{text}</Text>
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
      <Text style={[styles.statusPill, reservation.status === 'CONFIRMADA' ? styles.statusOk : styles.statusPending]}>{labelStatus(reservation.status)}</Text>
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

function BottomTabs({ active, onChange }: { active: HomeTab; onChange: (tab: HomeTab) => void }) {
  const tabs: Array<{ key: HomeTab; icon: keyof typeof Ionicons.glyphMap; label: string }> = [
    { key: 'home', icon: 'home', label: 'Inicio' },
    { key: 'reservations', icon: 'calendar-outline', label: 'Reservas' },
    { key: 'courts', icon: 'football-outline', label: 'Canchas' },
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

function relativeDate(date: string) {
  return date === todayIso ? 'Hoy' : date;
}

const dateOptions = Array.from({ length: 5 }, (_, index) => {
  const date = new Date(today);
  date.setDate(today.getDate() + index);
  const iso = date.toISOString().slice(0, 10);
  const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const longDays = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  return {
    iso,
    dayName: dayNames[date.getDay()],
    day: String(date.getDate()),
    month: monthNames[date.getMonth()],
    longLabel: `${longDays[date.getDay()]}, ${date.getDate()} de ${monthNames[date.getMonth()]}`
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
  guestButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  guestText: { color: '#ffffff', fontWeight: '700' },
  authScreen: { flexGrow: 1, padding: 24, gap: 12, backgroundColor: '#020b0d' },
  backButton: { width: 44, height: 44, justifyContent: 'center', marginBottom: 12 },
  authTitle: { color: '#ffffff', fontSize: 28, fontWeight: '900', marginTop: 8 },
  authSub: { color: '#c6ced4', fontSize: 14, marginBottom: 18 },
  field: { minHeight: 58, borderWidth: 1, borderColor: '#1f3236', borderRadius: 8, paddingHorizontal: 14, backgroundColor: 'rgba(11, 23, 26, 0.95)', flexDirection: 'row', alignItems: 'center', gap: 12 },
  fieldBody: { flex: 1 },
  fieldLabel: { color: '#c5cdd3', fontSize: 11, fontWeight: '700' },
  fieldInput: { color: '#ffffff', fontSize: 14, paddingVertical: 3 },
  loginOptions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 4 },
  remember: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  muted: { color: '#a7b0b6', fontSize: 13 },
  greenLink: { color: '#58c83c', fontWeight: '800' },
  mutedCenter: { color: '#c8d0d5', textAlign: 'center', marginTop: 10 },
  separator: { color: '#8d989f', textAlign: 'center', marginVertical: 10 },
  socialRow: { flexDirection: 'row', gap: 10 },
  socialButton: { flex: 1, minHeight: 52, borderRadius: 8, borderWidth: 1, borderColor: '#263a3f', backgroundColor: '#071315', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  socialText: { color: '#ffffff', fontWeight: '800' },
  forgotIcon: { width: 90, height: 90, borderRadius: 45, borderWidth: 1, borderColor: '#58c83c', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginVertical: 26 },
  centerCopy: { color: '#d9e0e3', fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 18 },
  button: { minHeight: 54, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#36b833', marginTop: 6 },
  outlineButton: { backgroundColor: 'rgba(0, 0, 0, 0.2)', borderWidth: 1, borderColor: '#ffffff' },
  buttonDisabled: { opacity: 0.55 },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '900' },
  outlineText: { color: '#ffffff' },
  appShell: { flex: 1, backgroundColor: '#020b0d' },
  page: { flexGrow: 1, padding: 22, paddingBottom: 104, backgroundColor: '#020b0d' },
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
  datePill: { width: 62, height: 78, borderRadius: 8, borderWidth: 1, borderColor: '#193136', backgroundColor: '#081719', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  datePillActive: { backgroundColor: '#36b833', borderColor: '#36b833' },
  dateDow: { color: '#c2cbd1', fontSize: 13, fontWeight: '800' },
  dateDay: { color: '#ffffff', fontSize: 20, fontWeight: '900' },
  dateMonth: { color: '#c2cbd1', fontSize: 13, fontWeight: '800' },
  activeText: { color: '#ffffff' },
  timeGrid: { paddingHorizontal: 20, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  slot: { width: '30.5%', minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: '#1a3035', backgroundColor: '#081719', alignItems: 'center', justifyContent: 'center' },
  slotActive: { backgroundColor: '#36b833', borderColor: '#36b833' },
  slotText: { color: '#ffffff', fontWeight: '900' },
  successScreen: { flex: 1, padding: 24, justifyContent: 'center', backgroundColor: '#020b0d' },
  successCircle: { width: 96, height: 96, borderRadius: 48, backgroundColor: '#58c83c', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 20 },
  successTitle: { color: '#ffffff', fontSize: 26, fontWeight: '900', textAlign: 'center', marginBottom: 8 },
  summaryCard: { borderWidth: 1, borderColor: '#1d363b', backgroundColor: '#081719', borderRadius: 8, padding: 16, marginVertical: 16 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 18, paddingVertical: 8 },
  summaryLabel: { color: '#aab3b9', flex: 1 },
  summaryValue: { color: '#ffffff', fontWeight: '900', flex: 1.2, textAlign: 'right' },
  reservationFullCard: { marginBottom: 12 },
  adminActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 18, paddingRight: 8 },
  danger: { color: '#ff625c', fontWeight: '900' },
  profileAvatar: { width: 96, height: 96, borderRadius: 48, backgroundColor: '#173337', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginTop: 40, marginBottom: 18 },
  emptyCard: { minHeight: 120, borderRadius: 8, borderWidth: 1, borderColor: '#182f33', backgroundColor: '#081719', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 18 },
  tabs: { position: 'absolute', left: 14, right: 14, bottom: 14, height: 72, borderRadius: 8, backgroundColor: '#071315', borderWidth: 1, borderColor: '#10252a', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  tabButton: { flex: 1, alignItems: 'center', gap: 5 },
  tabText: { color: '#98a2aa', fontSize: 12, fontWeight: '700' },
  tabActive: { color: '#58c83c' }
});
