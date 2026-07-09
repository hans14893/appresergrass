import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { api, setAuthToken } from './src/api/client';
import { subscribeAvailability } from './src/api/realtime';
import { AuthResponse, Court, Reservation, Role } from './src/types';
import { saveSession, getSession, clearSession } from './src/storage/session';

const today = new Date().toISOString().slice(0, 10);

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
      <StatusBar style="dark" />
      {session ? <HomeScreen session={session} onLogout={logout} /> : <AuthScreen onAuth={onAuth} />}
    </SafeAreaView>
  );
}

function AuthScreen({ onAuth }: { onAuth: (auth: AuthResponse) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    try {
      setBusy(true);
      const payload = mode === 'login'
        ? await api<AuthResponse>('/auth/login', { method: 'POST', body: { email, password } })
        : await api<AuthResponse>('/auth/register', { method: 'POST', body: { fullName, email, password, phone } });
      onAuth(payload);
    } catch (error) {
      Alert.alert('No se pudo ingresar', error instanceof Error ? error.message : 'Error desconocido');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.auth}>
      <Text style={styles.brand}>Reserva Grass</Text>
      <Text style={styles.subtitle}>Reservas de cancha por fecha y hora</Text>
      <View style={styles.segment}>
        <Pressable style={[styles.segmentButton, mode === 'login' && styles.segmentActive]} onPress={() => setMode('login')}>
          <Text style={styles.segmentText}>Ingresar</Text>
        </Pressable>
        <Pressable style={[styles.segmentButton, mode === 'register' && styles.segmentActive]} onPress={() => setMode('register')}>
          <Text style={styles.segmentText}>Registro</Text>
        </Pressable>
      </View>
      {mode === 'register' && <Input placeholder="Nombre completo" value={fullName} onChangeText={setFullName} />}
      <Input placeholder="Correo" value={email} onChangeText={setEmail} autoCapitalize="none" />
      <Input placeholder="Clave" value={password} onChangeText={setPassword} secureTextEntry />
      {mode === 'register' && <Input placeholder="Teléfono" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />}
      <Button title={busy ? 'Procesando...' : mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'} onPress={submit} disabled={busy} />
    </ScrollView>
  );
}

function HomeScreen({ session, onLogout }: { session: AuthResponse; onLogout: () => void }) {
  const [courts, setCourts] = useState<Court[]>([]);
  const [courtId, setCourtId] = useState<number | null>(null);
  const [date, setDate] = useState(today);
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('19:00');
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [busy, setBusy] = useState(false);

  const canManage = useMemo(() => session.role === 'PERSONAL' || session.role === 'ADMIN', [session.role]);

  useEffect(() => {
    api<Court[]>('/courts')
      .then((data) => {
        setCourts(data);
        setCourtId(data[0]?.id ?? null);
      })
      .catch((error) => Alert.alert('Canchas', error.message));
  }, []);

  useEffect(() => {
    if (!courtId) return;
    loadReservations();
    const unsubscribe = subscribeAvailability(courtId, date, () => loadReservations());
    return () => {
      unsubscribe();
    };
  }, [courtId, date]);

  const loadReservations = async () => {
    if (!courtId) return;
    const data = await api<Reservation[]>(`/reservations?courtId=${courtId}&date=${date}`);
    setReservations(data);
  };

  const createReservation = async () => {
    if (!courtId) return;
    try {
      setBusy(true);
      await api<Reservation>('/reservations', {
        method: 'POST',
        body: { courtId, reservationDate: date, startTime, endTime }
      });
      await loadReservations();
      Alert.alert('Reserva registrada', 'El horario quedó en estado pendiente.');
    } catch (error) {
      Alert.alert('No se pudo reservar', error instanceof Error ? error.message : 'Error desconocido');
    } finally {
      setBusy(false);
    }
  };

  const updateStatus = async (reservationId: number, status: string) => {
    await api<Reservation>(`/reservations/${reservationId}/status?status=${status}`, { method: 'PATCH' });
    await loadReservations();
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Calendario</Text>
          <Text style={styles.user}>{session.fullName} · {labelRole(session.role)}</Text>
        </View>
        <Pressable onPress={onLogout}><Text style={styles.link}>Salir</Text></Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.courtList}>
        {courts.map((court) => (
          <Pressable key={court.id} style={[styles.courtChip, court.id === courtId && styles.courtActive]} onPress={() => setCourtId(court.id)}>
            <Text style={styles.courtName}>{court.name}</Text>
            <Text style={styles.courtPrice}>S/ {court.hourlyPrice}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.formRow}>
        <Input small placeholder="Fecha YYYY-MM-DD" value={date} onChangeText={setDate} />
        <Input small placeholder="Inicio" value={startTime} onChangeText={setStartTime} />
        <Input small placeholder="Fin" value={endTime} onChangeText={setEndTime} />
      </View>
      <Button title={busy ? 'Guardando...' : 'Reservar horario'} onPress={createReservation} disabled={busy || !courtId} />

      {canManage && <AdminPanel />}

      <Text style={styles.section}>Reservas del día</Text>
      <FlatList
        data={reservations}
        keyExtractor={(item) => String(item.id)}
        ListEmptyComponent={<Text style={styles.empty}>No hay reservas para esta fecha.</Text>}
        renderItem={({ item }) => (
          <View style={styles.reservation}>
            <View>
              <Text style={styles.reservationTime}>{item.startTime} - {item.endTime}</Text>
              <Text style={styles.reservationClient}>{item.clientName}</Text>
              <Text style={styles.reservationMeta}>{item.status} · Pago {item.paymentStatus}</Text>
            </View>
            {canManage && item.status !== 'CANCELADA' && (
              <View style={styles.actions}>
                <Pressable onPress={() => updateStatus(item.id, 'CONFIRMADA')}><Text style={styles.link}>Confirmar</Text></Pressable>
                <Pressable onPress={() => updateStatus(item.id, 'CANCELADA')}><Text style={styles.danger}>Cancelar</Text></Pressable>
              </View>
            )}
          </View>
        )}
      />
    </View>
  );
}

function AdminPanel() {
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Panel autorizado</Text>
      <Text style={styles.panelText}>Desde aquí se confirman, cancelan y revisan reservas. La gestión completa de usuarios, canchas, horarios, pagos y reportes está expuesta en el backend para ampliar la pantalla administrativa.</Text>
    </View>
  );
}

function Input(props: React.ComponentProps<typeof TextInput> & { small?: boolean }) {
  const { small, style, ...rest } = props;
  return <TextInput style={[styles.input, small && styles.inputSmall, style]} placeholderTextColor="#77808a" {...rest} />;
}

function Button({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable style={[styles.button, disabled && styles.buttonDisabled]} onPress={onPress} disabled={disabled}>
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}

function Centered({ text }: { text: string }) {
  return (
    <SafeAreaView style={styles.centered}>
      <ActivityIndicator />
      <Text style={styles.subtitle}>{text}</Text>
    </SafeAreaView>
  );
}

function labelRole(role: Role) {
  return role === 'ADMIN' ? 'Administrador' : role === 'PERSONAL' ? 'Personal' : 'Cliente';
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f6f7f9' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  auth: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 12 },
  brand: { fontSize: 34, fontWeight: '800', color: '#17324d' },
  subtitle: { fontSize: 15, color: '#586575' },
  segment: { flexDirection: 'row', backgroundColor: '#e7ebef', borderRadius: 8, padding: 4, marginVertical: 8 },
  segmentButton: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 6 },
  segmentActive: { backgroundColor: '#ffffff' },
  segmentText: { fontWeight: '700', color: '#17324d' },
  input: { minHeight: 48, borderWidth: 1, borderColor: '#d7dde4', borderRadius: 8, paddingHorizontal: 14, backgroundColor: '#ffffff', color: '#17212b' },
  inputSmall: { flex: 1, minWidth: 105 },
  button: { minHeight: 50, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1f7a4d', marginTop: 4 },
  buttonDisabled: { opacity: 0.55 },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  container: { flex: 1, padding: 18, gap: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 28, fontWeight: '800', color: '#17212b' },
  user: { color: '#586575', marginTop: 4 },
  link: { color: '#1769aa', fontWeight: '800' },
  danger: { color: '#b42318', fontWeight: '800' },
  courtList: { flexGrow: 0 },
  courtChip: { minWidth: 140, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#d7dde4', backgroundColor: '#ffffff', marginRight: 10 },
  courtActive: { borderColor: '#1f7a4d', backgroundColor: '#eaf6ef' },
  courtName: { fontWeight: '800', color: '#17212b' },
  courtPrice: { color: '#586575', marginTop: 4 },
  formRow: { flexDirection: 'row', gap: 8 },
  section: { fontSize: 18, fontWeight: '800', color: '#17212b', marginTop: 6 },
  empty: { color: '#586575', paddingVertical: 18 },
  reservation: { padding: 14, borderRadius: 8, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e1e5ea', marginBottom: 10, flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  reservationTime: { fontSize: 16, fontWeight: '800', color: '#17212b' },
  reservationClient: { color: '#344252', marginTop: 4 },
  reservationMeta: { color: '#687586', marginTop: 4 },
  actions: { alignItems: 'flex-end', justifyContent: 'center', gap: 10 },
  panel: { padding: 14, borderRadius: 8, backgroundColor: '#fff7e6', borderWidth: 1, borderColor: '#ffe0a3' },
  panelTitle: { fontWeight: '800', color: '#5a3b00' },
  panelText: { marginTop: 4, color: '#6d551f', lineHeight: 19 }
});
