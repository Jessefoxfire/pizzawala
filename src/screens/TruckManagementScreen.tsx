import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  doc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from '@react-native-firebase/firestore';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { auth } from '../services/firebase';

type Props = NativeStackScreenProps<RootStackParamList, 'TruckManagement'>;

type TeamKey = 'all' | 'shared' | 'front' | 'kitchen' | 'driver';

type StepCheck = {
  id: string;
  prompt: string;
};

type TruckStep = {
  id: string;
  phase: string;
  team: Exclude<TeamKey, 'all'>;
  title: string;
  detail: string;
  accent: string;
  checks: StepCheck[];
};

type TruckProgressState = {
  team?: TeamKey;
  stepIndex?: number;
};

type SharedTruckMeta = {
  updatedByEmail: string;
  updatedAtLabel: string;
};

const TRUCK_PROGRESS_STORAGE_KEY = 'truck_management_progress_v1';
const TRUCK_MANAGEMENT_DOC_ID = 'team-1';

const TEAM_META: Record<TeamKey, { label: string; description: string; badge: string }> = {
  all: { label: 'All Teams', description: 'Full festival truck run-through', badge: 'All' },
  shared: { label: 'Shared', description: 'Tasks every crew should align on', badge: 'Shared' },
  front: { label: 'Team Front', description: 'Counter, drinks, display, service flow', badge: 'Front' },
  kitchen: { label: 'Team Kitchen', description: 'Oven, ingredients, dough, close-down', badge: 'Kitchen' },
  driver: { label: 'Driver & Close', description: 'Vehicle, utilities, load-out, departure', badge: 'Driver' },
};

const TRUCK_STEPS: TruckStep[] = [
  {
    id: 'driver-vehicle',
    phase: 'Phase 1 - Pre-Departure',
    team: 'driver',
    title: 'Vehicle ready to move',
    detail: 'Do the mechanical and compliance checks before anyone starts loading.',
    accent: '#C9782B',
    checks: [
      { id: 'diesel', prompt: 'Diesel tank full?' },
      { id: 'fresh-water', prompt: 'Fresh water tank full?' },
      { id: 'waste-water', prompt: 'Waste water tank empty?' },
      { id: 'tyres', prompt: 'Tyres checked?' },
      { id: 'lights', prompt: 'Lights checked?' },
      { id: 'docs', prompt: 'Vehicle documents onboard?' },
    ],
  },
  {
    id: 'driver-load-security',
    phase: 'Phase 1 - Pre-Departure',
    team: 'driver',
    title: 'Load secured before departure',
    detail: 'Nothing should shift once the truck starts moving.',
    accent: '#A0522D',
    checks: [
      { id: 'strapped', prompt: 'Everything strapped down securely?' },
      { id: 'loose-items', prompt: 'Nothing loose in the truck?' },
      { id: 'oven-secured', prompt: 'Oven secured?' },
      { id: 'countertops-secured', prompt: 'Countertops secured?' },
    ],
  },
  {
    id: 'driver-crew-admin',
    phase: 'Phase 1 - Pre-Departure',
    team: 'driver',
    title: 'Crew and admin packed',
    detail: 'Make sure the people side of the journey is covered before wheels roll.',
    accent: '#7C4D2B',
    checks: [
      { id: 'drinking-water', prompt: 'Drinking water for driver and crew onboard?' },
      { id: 'snacks', prompt: 'Snacks for driver and crew onboard?' },
      { id: 'chargers', prompt: 'Phone chargers packed?' },
      { id: 'power-banks', prompt: 'Power banks packed?' },
      { id: 'cash-system', prompt: 'Cash system and float onboard?' },
      { id: 'card-reader', prompt: 'Card reader charged?' },
      { id: 'event-contact', prompt: 'Event contact details and directions saved?' },
    ],
  },
  {
    id: 'shared-open-doors',
    phase: 'Phase 2 - Arrival',
    team: 'shared',
    title: 'Truck opened and safe to unload',
    detail: 'Open up first, confirm access, then the setup team can start moving.',
    accent: '#D9A441',
    checks: [
      { id: 'doors-open', prompt: 'Truck doors open?' },
      { id: 'service-flap-open', prompt: 'Main service flap open and secure?' },
      { id: 'rear-access-clear', prompt: 'Rear access area clear?' },
      { id: 'dough-drawer-stock', prompt: 'Is there dough or dough balls in the ball drawer?' },
    ],
  },
  {
    id: 'shared-empty-truck',
    phase: 'Phase 2 - Arrival',
    team: 'shared',
    title: 'Truck emptied for setup',
    detail: 'Nothing else happens until these essentials are out.',
    accent: '#B7862F',
    checks: [
      { id: 'counter', prompt: 'Counter unloaded?' },
      { id: 'stairs', prompt: 'Stairs unloaded?' },
      { id: 'floor-panels', prompt: 'Floor panels out if required?' },
      { id: 'peels', prompt: 'Wooden and metal peels out?' },
      { id: 'fridge', prompt: 'Drinks fridge unloaded?' },
      { id: 'signage', prompt: 'Signage and setup equipment unloaded?' },
    ],
  },
  {
    id: 'front-counter-position',
    phase: 'Phase 3 - Rapid Setup',
    team: 'front',
    title: 'Counter positioned before loading it',
    detail: 'Once the counter is loaded it becomes difficult to move, so get the footprint right first.',
    accent: '#E69A2F',
    checks: [
      { id: 'final-position', prompt: 'Final counter position confirmed?' },
      { id: 'edges-aligned', prompt: 'Counter edges aligned with service flap handles?' },
      { id: 'customer-flow', prompt: 'Customer flow confirmed?' },
      { id: 'working-space', prompt: 'Working space confirmed?' },
      { id: 'counter-positioned', prompt: 'Counter positioned and assembled?' },
    ],
  },
  {
    id: 'front-structure',
    phase: 'Phase 3 - Rapid Setup',
    team: 'front',
    title: 'Front-of-house access installed',
    detail: 'Build the customer and staff access path early so everything else has a clear place.',
    accent: '#C46B28',
    checks: [
      { id: 'stairs-positioned', prompt: 'Stairs positioned?' },
      { id: 'floor-installed', prompt: 'Floor panels installed if required?' },
    ],
  },
  {
    id: 'shared-power',
    phase: 'Phase 3 - Rapid Setup',
    team: 'shared',
    title: 'Power live across the truck',
    detail: 'Shared step for every team because almost everything depends on it.',
    accent: '#8C5A1D',
    checks: [
      { id: 'event-power', prompt: 'Event power connected?' },
      { id: 'extensions', prompt: 'Extension cables run?' },
      { id: 'multiplugs', prompt: 'Multi-plugs connected?' },
      { id: 'power-verified', prompt: 'Power verified and stable?' },
    ],
  },
  {
    id: 'front-drinks',
    phase: 'Phase 3 - Rapid Setup',
    team: 'front',
    title: 'Drinks fridge stocked and running',
    detail: 'Get chilled stock live early so the front team is not catching up later.',
    accent: '#617A3A',
    checks: [
      { id: 'fridge-positioned', prompt: 'Drinks fridge positioned?' },
      { id: 'fridge-power', prompt: 'Fridge power connected?' },
      { id: 'fridge-running', prompt: 'Fridge operating?' },
      { id: 'crates-unloaded', prompt: 'Drink crates unloaded?' },
      { id: 'fridge-stocked', prompt: 'Drinks stocked into fridge?' },
    ],
  },
  {
    id: 'front-service-stock',
    phase: 'Phase 3 - Rapid Setup',
    team: 'front',
    title: 'Front counter stocked for service',
    detail: 'Set the service line in the order customers and staff will use it.',
    accent: '#9D6B4D',
    checks: [
      { id: 'plates', prompt: 'Plates set out?' },
      { id: 'serviettes', prompt: 'Customer serviettes set out?' },
      { id: 'napkin-holder', prompt: 'Napkin holder set up?' },
      { id: 'pizza-boxes', prompt: 'Pizza boxes ready?' },
    ],
  },
  {
    id: 'front-cash',
    phase: 'Phase 3 - Rapid Setup',
    team: 'front',
    title: 'Cash system live',
    detail: 'Do not leave payments to the last minute.',
    accent: '#6C5238',
    checks: [
      { id: 'cash-setup', prompt: 'Cash system set up?' },
      { id: 'cash-power', prompt: 'Cash system connected to power?' },
      { id: 'cash-operational', prompt: 'Cash system operational?' },
    ],
  },
  {
    id: 'front-tools-condiments',
    phase: 'Phase 3 - Rapid Setup',
    team: 'front',
    title: 'Serving tools and condiments in place',
    detail: 'Set up the line so the front team can serve without hunting for basics.',
    accent: '#B85738',
    checks: [
      { id: 'cutting-board', prompt: 'Pizza cutting board positioned?' },
      { id: 'cutters', prompt: 'Pizza cutters positioned?' },
      { id: 'slice-server', prompt: 'Slice server positioned?' },
      { id: 'serving-board', prompt: 'Serving board positioned?' },
      { id: 'condiments', prompt: 'Salt, pepper, oregano, chilli oil and Tabasco stocked?' },
    ],
  },
  {
    id: 'front-display',
    phase: 'Phase 3 - Rapid Setup',
    team: 'front',
    title: 'Display finished',
    detail: 'Leave the truck looking intentional, not half-dressed.',
    accent: '#D48456',
    checks: [
      { id: 'sign-installed', prompt: 'Sign installed?' },
      { id: 'roof-sign', prompt: 'Roof sign raised and secured?' },
      { id: 'decorations', prompt: 'Decorations and lights installed?' },
      { id: 'basil', prompt: 'Basil plants positioned?' },
      { id: 'labels', prompt: 'Pizza label stands and cards inserted?' },
    ],
  },
  {
    id: 'kitchen-oven',
    phase: 'Phase 3 - Rapid Setup',
    team: 'kitchen',
    title: 'Oven started immediately',
    detail: 'The oven cannot wait. Fire it early and build temperature while the rest of setup happens.',
    accent: '#E25822',
    checks: [
      { id: 'chimney', prompt: 'Chimney installed?' },
      { id: 'fire-started', prompt: 'Fire started immediately?' },
      { id: 'wood-added', prompt: 'Initial firewood added?' },
      { id: 'temp-rising', prompt: 'Oven coming up to temperature?' },
    ],
  },
  {
    id: 'kitchen-ingredients',
    phase: 'Phase 3 - Rapid Setup',
    team: 'kitchen',
    title: 'Ingredients moved into working order',
    detail: 'Move product into the working top cooler in the order the team will use it.',
    accent: '#B53D1D',
    checks: [
      { id: 'lower-fridges', prompt: 'Lower fridges opened?' },
      { id: 'containers-up', prompt: 'Stainless steel containers moved to top cooler?' },
      { id: 'working-order', prompt: 'Ingredients organised in working order?' },
    ],
  },
  {
    id: 'kitchen-tools',
    phase: 'Phase 3 - Rapid Setup',
    team: 'kitchen',
    title: 'Kitchen tools staged',
    detail: 'Place the tools exactly where they will be used.',
    accent: '#8D2A18',
    checks: [
      { id: 'rolling-machine', prompt: 'Rolling machine positioned on counter?' },
      { id: 'mixer', prompt: 'Dough mixer positioned on floor?' },
      { id: 'peels', prompt: 'Wooden and metal peels positioned?' },
      { id: 'boards-knives', prompt: 'Cutting boards and knives positioned?' },
      { id: 'utensils', prompt: 'Spoons and sauce ladle positioned?' },
      { id: 'cleaning', prompt: 'Cleaning supplies, garbage cans and bags installed?' },
    ],
  },
  {
    id: 'kitchen-dough',
    phase: 'Phase 3 - Rapid Setup',
    team: 'kitchen',
    title: 'Dough production started',
    detail: 'Do not wait for the rush to discover the next batch is missing.',
    accent: '#A84425',
    checks: [
      { id: 'dough-stock', prompt: 'Dough stock levels checked?' },
      { id: 'next-batch', prompt: 'Next dough batch started immediately?' },
    ],
  },
  {
    id: 'shared-pre-open',
    phase: 'Phase 4 - Pre-Opening Check',
    team: 'shared',
    title: 'Truck ready to open',
    detail: 'This is the handover moment between setup and trading.',
    accent: '#3C7A5B',
    checks: [
      { id: 'oven-temp', prompt: 'Oven approaching service temperature?' },
      { id: 'ingredients-stocked', prompt: 'Ingredients stocked?' },
      { id: 'dough-underway', prompt: 'Dough production underway?' },
      { id: 'front-complete', prompt: 'Front counter complete?' },
      { id: 'drinks-stocked', prompt: 'Drinks fridge stocked?' },
      { id: 'power-cash', prompt: 'Power and cash system operational?' },
      { id: 'customer-area', prompt: 'Customer area complete and ready?' },
    ],
  },
  {
    id: 'shared-open-service',
    phase: 'Phase 5 - Open For Service',
    team: 'shared',
    title: 'Open for service',
    detail: 'Use a simple launch sequence so the whole team knows the truck is live.',
    accent: '#2F8A6A',
    checks: [
      { id: 'dough-ball-ready', prompt: 'First dough ball ready?' },
      { id: 'first-pizza', prompt: 'First pizza launched?' },
      { id: 'service-open', prompt: 'Truck open for service?' },
    ],
  },
  {
    id: 'shared-close-service',
    phase: 'Phase 6 - Close Service',
    team: 'shared',
    title: 'Close the service line cleanly',
    detail: 'Stop new orders without leaving the front looking chaotic.',
    accent: '#7A5A3A',
    checks: [
      { id: 'roof-light-off', prompt: 'Roof sign light off?' },
      { id: 'orders-stopped', prompt: 'Stopped taking new orders?' },
      { id: 'remaining-served', prompt: 'Remaining customers served?' },
      { id: 'front-packed', prompt: 'Condiments, basil, label stands, label cards and napkin holder packed?' },
    ],
  },
  {
    id: 'kitchen-food-storage',
    phase: 'Phase 7 - Food Storage',
    team: 'kitchen',
    title: 'Food returned to refrigerated storage',
    detail: 'Close every container and get product back into safe storage before moving on.',
    accent: '#556B2F',
    checks: [
      { id: 'containers-lidded', prompt: 'Ingredients back in stainless containers with lids fitted?' },
      { id: 'sanitised', prompt: 'Container exteriors and lids disinfected?' },
      { id: 'lower-fridges-loaded', prompt: 'Containers stacked into lower fridges?' },
      { id: 'top-cooler-empty', prompt: 'Top cooler empty?' },
      { id: 'food-refrigerated', prompt: 'All food refrigerated?' },
    ],
  },
  {
    id: 'kitchen-quick-clean',
    phase: 'Phase 8 - Quick Clean',
    team: 'kitchen',
    title: 'Work areas reset',
    detail: 'Do the fast clean while the team still has energy.',
    accent: '#4C6A53',
    checks: [
      { id: 'rubbish-cleared', prompt: 'Rubbish cleared from work areas?' },
      { id: 'surfaces-wiped', prompt: 'Countertops, prep and serving surfaces wiped?' },
      { id: 'debris-swept', prompt: 'Visible debris swept?' },
      { id: 'customer-area-tidy', prompt: 'Customer area left tidy?' },
    ],
  },
  {
    id: 'kitchen-oven-shutdown',
    phase: 'Phase 9 - Oven Shutdown',
    team: 'kitchen',
    title: 'Oven shut down for transport',
    detail: 'Treat this as a safety-critical step, not a tidy-up step.',
    accent: '#7B3F00',
    checks: [
      { id: 'ashes-emptied', prompt: 'Ashes emptied and bucket stored?' },
      { id: 'chimney-removed', prompt: 'Chimney removed from roof and secured for transport?' },
      { id: 'oven-clear', prompt: 'Nothing left on top of oven?' },
      { id: 'oven-secured', prompt: 'Oven secured for transport?' },
      { id: 'firewood-packed', prompt: 'Firewood and fire-lighting supplies packed?' },
    ],
  },
  {
    id: 'driver-water',
    phase: 'Phase 10 - Utilities',
    team: 'driver',
    title: 'Water disconnected and drained',
    detail: 'Finish the water line properly so nothing is left dragging or dripping.',
    accent: '#2A6F97',
    checks: [
      { id: 'water-disconnected', prompt: 'Water disconnected?' },
      { id: 'pipes-emptied', prompt: 'Water pipes emptied?' },
      { id: 'pipes-rolled', prompt: 'Water pipes rolled and stored?' },
    ],
  },
  {
    id: 'driver-electrical',
    phase: 'Phase 10 - Utilities',
    team: 'driver',
    title: 'Electrical disconnected and counted',
    detail: 'Count the cable channels and pack the power kit in one pass.',
    accent: '#215A6D',
    checks: [
      { id: 'channels-collected', prompt: 'All 4 PW cable channels collected?' },
      { id: 'channels-confirmed', prompt: 'Confirmed 4 cable channels onboard?' },
      { id: 'power-disconnected', prompt: 'Power disconnected?' },
      { id: 'cables-rolled', prompt: 'Extension cables and main power cable rolled?' },
      { id: 'multiplugs-packed', prompt: 'Cables and multi-plugs stored?' },
    ],
  },
  {
    id: 'driver-waste',
    phase: 'Phase 11 - Waste',
    team: 'driver',
    title: 'Waste removed from site',
    detail: 'Do not leave this to the final minute when the team is already half in the vehicle.',
    accent: '#6B4F3A',
    checks: [
      { id: 'bags-removed', prompt: 'Garbage bags removed and tied securely?' },
      { id: 'waste-disposed', prompt: 'Waste disposed onsite or loaded for disposal elsewhere?' },
      { id: 'bins-emptied', prompt: 'Garbage cans emptied and packed?' },
      { id: 'no-rubbish-left', prompt: 'No rubbish left onsite?' },
    ],
  },
  {
    id: 'front-pack-service',
    phase: 'Phase 12 - Pack Equipment',
    team: 'front',
    title: 'Front service gear packed',
    detail: 'Pack the service layer together so it is easy to find at the next event.',
    accent: '#8C6A43',
    checks: [
      { id: 'service-packed', prompt: 'Plates, serviettes, pizza boxes, slice server and serving board packed?' },
      { id: 'cleaning-packed', prompt: 'Cleaning supplies and garbage bags packed?' },
    ],
  },
  {
    id: 'front-pack-stall',
    phase: 'Phase 13 - Pack Stall',
    team: 'front',
    title: 'Display and stall packed down',
    detail: 'Pack the visual layer last once trading is truly over.',
    accent: '#9A7B4F',
    checks: [
      { id: 'decor-packed', prompt: 'Decorations and lights packed?' },
      { id: 'roof-sign-off', prompt: 'Sign removed from roof, folded and secured?' },
      { id: 'furniture-packed', prompt: 'Tables and chairs packed?' },
    ],
  },
  {
    id: 'driver-load-truck',
    phase: 'Phase 14 - Load Truck',
    team: 'driver',
    title: 'Truck loaded into fixed transport positions',
    detail: 'Follow the known locations so unloading is consistent and nothing shifts in transit.',
    accent: '#5F4B32',
    checks: [
      { id: 'bars-under-drawers', prompt: 'Sign reinforcement bars stored under dough-tray drawers?' },
      { id: 'chimney-bin', prompt: 'Chimney inside square garbage bin under oven, wedged with decoration boxes?' },
      { id: 'countertops-flat', prompt: 'Countertops flat against fridge doors?' },
      { id: 'counter-folded', prompt: 'Counter folded, placed against countertops and secured?' },
      { id: 'drawers-secured', prompt: 'Drawers finalised, closed and secured?' },
      { id: 'dirty-linen-last', prompt: 'Dirty Linen & Washing Box loaded last of all?' },
      { id: 'load-check', prompt: 'All cables loaded and nothing can move during transit?' },
    ],
  },
  {
    id: 'shared-site-clean',
    phase: 'Phase 15 - Site Cleanliness',
    team: 'shared',
    title: 'Site cleaner than found',
    detail: 'This is the rebooking standard, not an optional extra.',
    accent: '#3E6B48',
    checks: [
      { id: 'rubbish-removed', prompt: 'All rubbish removed?' },
      { id: 'small-litter', prompt: 'Cigarette butts, bottle caps, cable ties and tape removed?' },
      { id: 'tables-checked', prompt: 'Checked beneath tables and beyond the stall footprint?' },
      { id: 'cleaner-than-found', prompt: 'Would the organiser be happy to invite us back?' },
    ],
  },
  {
    id: 'driver-final-secure',
    phase: 'Phase 16 - Final Vehicle Securing',
    team: 'driver',
    title: 'All openings closed and locked',
    detail: 'Do one deliberate pass over roof, flap, windows and hatches.',
    accent: '#513A2F',
    checks: [
      { id: 'roof-packed', prompt: 'Chimney packed and roof sign folded/strapped?' },
      { id: 'shock-protectors', prompt: 'Gas-shock safety protectors removed and stored?' },
      { id: 'service-flap', prompt: 'Main service flap closed and secured with Allen key?' },
      { id: 'other-openings', prompt: 'Side window, rear hatch, rear doors and compartments closed?' },
    ],
  },
  {
    id: 'driver-storage-mode',
    phase: 'Phase 17 - Truck Storage Mode',
    team: 'driver',
    title: 'Correct fuse mode selected',
    detail: 'Set the truck correctly depending on whether dough balls remain in the drawers.',
    accent: '#365C7D',
    checks: [
      { id: 'fuse-4', prompt: 'Fuse 4 on?' },
      { id: 'fuse-6', prompt: 'Fuse 6 on?' },
      { id: 'dough-fuse-mode', prompt: 'Fuse 5 set correctly for dough balls present or absent?' },
      { id: 'others-off', prompt: 'All other fuses off?' },
      { id: 'water-pump-off', prompt: 'Water pump off?' },
      { id: 'verify-fridges', prompt: 'Refrigerators operating and internal lights off?' },
    ],
  },
  {
    id: 'shared-walkaround',
    phase: 'Phase 18 - Final Walkaround',
    team: 'shared',
    title: '360 degree safety walkaround',
    detail: 'Do not move until someone has physically walked the truck.',
    accent: '#4D5A6A',
    checks: [
      { id: 'walkaround', prompt: 'Complete 360 degree walkaround done?' },
      { id: 'wheels', prompt: 'Checked around wheels and beneath truck?' },
      { id: 'forgotten-items', prompt: 'No forgotten equipment, cables, pipes or tools?' },
      { id: 'people-clear', prompt: 'No children or animals near vehicle?' },
    ],
  },
  {
    id: 'driver-site-verification',
    phase: 'Phase 19 - Site Verification',
    team: 'driver',
    title: 'Final site verification after moving',
    detail: 'Expose the full pitch, then verify both the load and the site condition.',
    accent: '#70543E',
    checks: [
      { id: 'move-forward', prompt: 'Truck moved forward to expose the full site?' },
      { id: 'load-secure', prompt: 'Load checked for shifting and remains secure?' },
      { id: 'site-spotless', prompt: 'Entire pitch inspected and spotless?' },
      { id: 'photos', prompt: 'Site photographed as evidence?' },
    ],
  },
  {
    id: 'shared-depart',
    phase: 'Phase 20 - Depart',
    team: 'shared',
    title: 'Final departure check',
    detail: 'A short final pause avoids stupid misses.',
    accent: '#8A5A44',
    checks: [
      { id: 'final-visual', prompt: 'Final visual check complete?' },
      { id: 'departed', prompt: 'Truck departed site?' },
    ],
  },
  {
    id: 'shared-home',
    phase: 'Phase 21 - Arrival Home',
    team: 'shared',
    title: 'Home reset started immediately',
    detail: 'The post-event reset starts as soon as the truck is home.',
    accent: '#5D7A61',
    checks: [
      { id: 'dirty-box-first', prompt: 'Dirty Linen & Washing Box unloaded first?' },
      { id: 'washing-started', prompt: 'Tea towels, cloths and aprons washing started?' },
      { id: 'dishes', prompt: 'Dishes and kitchen items washed?' },
      { id: 'ingredients', prompt: 'Remaining ingredients refrigerated if required?' },
      { id: 'deep-clean', prompt: 'Deep clean completed if required?' },
    ],
  },
];

function getAnswerKey(stepId: string, checkId: string) {
  return `${stepId}:${checkId}`;
}

export default function TruckManagementScreen({ navigation }: Props) {
  const [team, setTeam] = useState<TeamKey>('all');
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, boolean | undefined>>({});
  const [hydrated, setHydrated] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const [sharedMeta, setSharedMeta] = useState<SharedTruckMeta | null>(null);
  const lastSyncedAnswersRef = useRef('{}');

  const visibleSteps = useMemo(() => {
    if (team === 'all') return TRUCK_STEPS;
    if (team === 'shared') return TRUCK_STEPS.filter(step => step.team === 'shared');
    return TRUCK_STEPS.filter(step => step.team === 'shared' || step.team === team);
  }, [team]);

  useEffect(() => {
    setStepIndex(0);
  }, [team]);

  useEffect(() => {
    let cancelled = false;

    const loadSavedProgress = async () => {
      try {
        const raw = await AsyncStorage.getItem(TRUCK_PROGRESS_STORAGE_KEY);
        if (!raw || cancelled) {
          setHydrated(true);
          return;
        }
        const parsed = JSON.parse(raw) as TruckProgressState;
        if (parsed.team && TEAM_META[parsed.team]) {
          setTeam(parsed.team);
        }
        if (typeof parsed.stepIndex === 'number' && Number.isFinite(parsed.stepIndex) && parsed.stepIndex >= 0) {
          setStepIndex(parsed.stepIndex);
        }
      } catch {
        // Ignore corrupt local state and continue with defaults.
      } finally {
        if (!cancelled) {
          setHydrated(true);
        }
      }
    };

    void loadSavedProgress();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    void AsyncStorage.setItem(
      TRUCK_PROGRESS_STORAGE_KEY,
      JSON.stringify({ team, stepIndex } satisfies TruckProgressState)
    );
  }, [hydrated, stepIndex, team]);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user?.uid) {
      setCloudReady(true);
      return undefined;
    }

    const fs = getFirestore();
    const sharedDocRef = doc(fs, 'truckManagement', TRUCK_MANAGEMENT_DOC_ID);
    const unsubscribe = onSnapshot(
      sharedDocRef,
      snap => {
        const data = snap.exists() ? snap.data() : null;
        const nextAnswers =
          data?.answers && typeof data.answers === 'object'
            ? (data.answers as Record<string, boolean | undefined>)
            : {};
        const serialized = JSON.stringify(nextAnswers);
        lastSyncedAnswersRef.current = serialized;
        setAnswers(nextAnswers);
        setSharedMeta(
          data
            ? {
                updatedByEmail: String(data.updatedByEmail || ''),
                updatedAtLabel: formatSharedTimestamp(data.updatedAt),
              }
            : null
        );
        setCloudReady(true);
      },
      () => {
        setCloudReady(true);
      }
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!hydrated || !cloudReady) return;
    const user = auth.currentUser;
    if (!user?.uid) return;

    const serialized = JSON.stringify(answers);
    if (serialized === lastSyncedAnswersRef.current) return;

    const timeout = setTimeout(() => {
      const fs = getFirestore();
      const sharedDocRef = doc(fs, 'truckManagement', TRUCK_MANAGEMENT_DOC_ID);
      lastSyncedAnswersRef.current = serialized;
      void setDoc(
        sharedDocRef,
        {
          answers,
          teamId: TRUCK_MANAGEMENT_DOC_ID,
          updatedAt: serverTimestamp(),
          updatedByUid: user.uid,
          updatedByEmail: user.email || '',
        },
        { merge: true }
      );
    }, 500);

    return () => clearTimeout(timeout);
  }, [answers, cloudReady, hydrated]);

  useEffect(() => {
    if (stepIndex < visibleSteps.length) return;
    setStepIndex(Math.max(visibleSteps.length - 1, 0));
  }, [stepIndex, visibleSteps.length]);

  const formatSharedTimestamp = (raw: any) => {
    if (raw && typeof raw.toDate === 'function') {
      try {
        return raw.toDate().toLocaleString();
      } catch {
        return '';
      }
    }
    return '';
  };

  const currentStep = visibleSteps[stepIndex];

  const completeSteps = useMemo(
    () =>
      visibleSteps.filter(step =>
        step.checks.every(check => answers[getAnswerKey(step.id, check.id)] === true)
      ).length,
    [answers, visibleSteps]
  );

  const totalChecks = useMemo(
    () => visibleSteps.reduce((sum, step) => sum + step.checks.length, 0),
    [visibleSteps]
  );

  const answeredChecks = useMemo(
    () =>
      visibleSteps.reduce(
        (sum, step) =>
          sum +
          step.checks.filter(check => answers[getAnswerKey(step.id, check.id)] !== undefined).length,
        0
      ),
    [answers, visibleSteps]
  );

  const progressRatio = visibleSteps.length ? completeSteps / visibleSteps.length : 0;
  const stepYesCount = currentStep
    ? currentStep.checks.filter(check => answers[getAnswerKey(currentStep.id, check.id)] === true).length
    : 0;
  const stepNoCount = currentStep
    ? currentStep.checks.filter(check => answers[getAnswerKey(currentStep.id, check.id)] === false).length
    : 0;
  const currentStepDone = !!currentStep && currentStep.checks.every(check => answers[getAnswerKey(currentStep.id, check.id)] === true);

  const upcoming = visibleSteps.slice(stepIndex + 1, stepIndex + 4);

  const setAnswer = (stepId: string, checkId: string, value: boolean) => {
    setAnswers(current => ({
      ...current,
      [getAnswerKey(stepId, checkId)]: value,
    }));
  };

  const jumpToNextIncomplete = () => {
    const nextIndex = visibleSteps.findIndex(
      (step, index) =>
        index > stepIndex &&
        !step.checks.every(check => answers[getAnswerKey(step.id, check.id)] === true)
    );
    if (nextIndex >= 0) {
      setStepIndex(nextIndex);
      return;
    }
    if (visibleSteps.length > 0) {
      setStepIndex(visibleSteps.length - 1);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>‹ Admin</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Truck Management</Text>
        <View style={{ width: 56 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {!hydrated || !cloudReady ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator color="#E2A14A" />
            <Text style={styles.loadingText}>Restoring shared truck progress…</Text>
          </View>
        ) : null}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.teamRow}>
          {(Object.keys(TEAM_META) as TeamKey[]).map(teamKey => {
            const selected = team === teamKey;
            return (
              <TouchableOpacity
                key={teamKey}
                style={[styles.teamChip, selected && styles.teamChipActive]}
                onPress={() => setTeam(teamKey)}
              >
                <Text style={[styles.teamChipBadge, selected && styles.teamChipBadgeActive]}>
                  {TEAM_META[teamKey].badge}
                </Text>
                <Text style={[styles.teamChipTitle, selected && styles.teamChipTitleActive]}>
                  {TEAM_META[teamKey].label}
                </Text>
                <Text style={[styles.teamChipText, selected && styles.teamChipTextActive]}>
                  {TEAM_META[teamKey].description}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.heroCard}>
          <Text style={styles.heroEyebrow}>PIZZAWALA FESTIVAL TRUCK OPERATIONS</Text>
          <Text style={styles.heroTitle}>Need-to-know steps, split by team</Text>
          <Text style={styles.heroText}>
            Use the team selector to reduce noise. Shared tasks appear for every team. Each card is one action cluster only.
          </Text>
        </View>

        <View style={styles.progressCard}>
          <View style={styles.progressTopRow}>
            <View>
              <Text style={styles.progressLabel}>Progress</Text>
              <Text style={styles.progressValue}>
                {completeSteps}/{visibleSteps.length} tasks complete
              </Text>
            </View>
            <View style={styles.progressPill}>
              <Text style={styles.progressPillText}>
                {answeredChecks}/{totalChecks} checks answered
              </Text>
            </View>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.max(progressRatio * 100, 4)}%` }]} />
          </View>
          <Text style={styles.progressSub}>
            Step {visibleSteps.length === 0 ? 0 : stepIndex + 1} of {visibleSteps.length}
          </Text>
          {sharedMeta?.updatedByEmail || sharedMeta?.updatedAtLabel ? (
            <View style={styles.sharedMetaBanner}>
              <Text style={styles.sharedMetaTitle}>Shared checklist status</Text>
              <Text style={styles.sharedMetaText}>
                Last updated by {sharedMeta.updatedByEmail || 'unknown user'}
                {sharedMeta.updatedAtLabel ? ` at ${sharedMeta.updatedAtLabel}` : ''}
              </Text>
            </View>
          ) : null}
          <TouchableOpacity
            style={styles.resetLink}
            onPress={() => {
              setAnswers({});
              setTeam('all');
              setStepIndex(0);
            }}
          >
            <Text style={styles.resetLinkText}>Reset saved progress</Text>
          </TouchableOpacity>
        </View>

        {currentStep ? (
          <View style={[styles.stepCard, { borderColor: currentStep.accent }]}>
            <View style={styles.stepHeaderRow}>
              <View>
                <Text style={styles.phaseText}>{currentStep.phase}</Text>
                <Text style={styles.stepTitle}>{currentStep.title}</Text>
                <Text style={styles.stepDetail}>{currentStep.detail}</Text>
              </View>
              <View style={[styles.statusBadge, currentStepDone ? styles.statusDone : stepNoCount > 0 ? styles.statusNeedsWork : styles.statusInProgress]}>
                <Text style={styles.statusBadgeText}>
                  {currentStepDone ? 'Done' : stepNoCount > 0 ? 'Needs Fix' : 'In Progress'}
                </Text>
              </View>
            </View>

            <View style={styles.stepMiniStats}>
              <Text style={styles.stepMiniStat}>{stepYesCount}/{currentStep.checks.length} checks confirmed</Text>
              <Text style={styles.stepMiniStatWarn}>
                {stepNoCount > 0 ? `${stepNoCount} blocked` : 'No blockers flagged'}
              </Text>
            </View>

            <View style={styles.checkList}>
              {currentStep.checks.map((check, idx) => {
                const value = answers[getAnswerKey(currentStep.id, check.id)];
                return (
                  <View key={check.id} style={styles.checkCard}>
                    <View style={styles.checkPromptRow}>
                      <Text style={styles.checkIndex}>{String(idx + 1).padStart(2, '0')}</Text>
                      <Text style={styles.checkPrompt}>{check.prompt}</Text>
                    </View>
                    <View style={styles.answerRow}>
                      <TouchableOpacity
                        style={[styles.answerButton, value === true && styles.answerYesActive]}
                        onPress={() => setAnswer(currentStep.id, check.id, true)}
                      >
                        <Text style={[styles.answerText, value === true && styles.answerTextActive]}>Yes</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.answerButton, value === false && styles.answerNoActive]}
                        onPress={() => setAnswer(currentStep.id, check.id, false)}
                      >
                        <Text style={[styles.answerText, value === false && styles.answerTextActive]}>No</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </View>

            <View style={styles.navRow}>
              <TouchableOpacity
                style={[styles.navButton, stepIndex === 0 && styles.navButtonDisabled]}
                onPress={() => setStepIndex(index => Math.max(0, index - 1))}
                disabled={stepIndex === 0}
              >
                <Text style={styles.navButtonText}>Previous</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.navButtonAccent} onPress={jumpToNextIncomplete}>
                <Text style={styles.navButtonAccentText}>
                  {stepIndex === visibleSteps.length - 1 ? 'Stay on final step' : 'Next unresolved'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.navButton, stepIndex === visibleSteps.length - 1 && styles.navButtonDisabled]}
                onPress={() => setStepIndex(index => Math.min(visibleSteps.length - 1, index + 1))}
                disabled={stepIndex === visibleSteps.length - 1}
              >
                <Text style={styles.navButtonText}>Next</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        <View style={styles.sidebarCard}>
          <Text style={styles.sidebarTitle}>Up Next</Text>
          <Text style={styles.sidebarSub}>Preview the next few steps without dumping the full manual on screen.</Text>
          {upcoming.length === 0 ? (
            <Text style={styles.sidebarEmpty}>You are on the final visible step for this team.</Text>
          ) : (
            upcoming.map((step, index) => (
              <TouchableOpacity key={step.id} style={styles.upNextItem} onPress={() => setStepIndex(stepIndex + index + 1)}>
                <View style={[styles.upNextDot, { backgroundColor: step.accent }]} />
                <View style={styles.upNextBody}>
                  <Text style={styles.upNextPhase}>{step.phase}</Text>
                  <Text style={styles.upNextTitle}>{step.title}</Text>
                </View>
                <Text style={styles.upNextArrow}>›</Text>
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#16110E',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#332720',
    backgroundColor: '#1D1612',
  },
  back: { color: '#E2A14A', fontSize: 16, fontWeight: '700' },
  title: { color: '#F8F1E8', fontSize: 24, fontWeight: '800' },
  content: {
    padding: 18,
    paddingBottom: 40,
    gap: 16,
  },
  loadingCard: {
    backgroundColor: '#221A15',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#3C2E25',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    color: '#D8C4B2',
    fontSize: 13,
    fontWeight: '700',
  },
  heroCard: {
    backgroundColor: '#2B2019',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#4B382B',
  },
  heroEyebrow: {
    color: '#D8B07A',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 8,
  },
  heroTitle: {
    color: '#FFF6EC',
    fontSize: 28,
    fontWeight: '900',
    lineHeight: 32,
    marginBottom: 8,
  },
  heroText: {
    color: '#D6C0AC',
    fontSize: 14,
    lineHeight: 20,
  },
  teamRow: {
    gap: 12,
    paddingRight: 12,
  },
  teamChip: {
    width: 210,
    backgroundColor: '#201813',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#3B2C22',
  },
  teamChipActive: {
    backgroundColor: '#3A2619',
    borderColor: '#E2A14A',
  },
  teamChipBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#32261F',
    color: '#C9AA82',
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: 'hidden',
    marginBottom: 10,
  },
  teamChipBadgeActive: {
    backgroundColor: '#E2A14A',
    color: '#2A170E',
  },
  teamChipTitle: {
    color: '#F8F1E8',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 6,
  },
  teamChipTitleActive: {
    color: '#FFF8EF',
  },
  teamChipText: {
    color: '#BFA690',
    fontSize: 12,
    lineHeight: 17,
  },
  teamChipTextActive: {
    color: '#E9D7C7',
  },
  progressCard: {
    backgroundColor: '#221A15',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#3C2E25',
  },
  progressTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    marginBottom: 12,
    gap: 12,
  },
  progressLabel: {
    color: '#C7AA86',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  progressValue: {
    color: '#FFF7ED',
    fontSize: 24,
    fontWeight: '900',
    marginTop: 4,
  },
  progressPill: {
    backgroundColor: '#16110E',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#433228',
    maxWidth: '100%',
    flexShrink: 1,
    alignSelf: 'flex-start',
  },
  progressPillText: {
    color: '#D9C4AE',
    fontSize: 12,
    fontWeight: '700',
    flexShrink: 1,
  },
  progressTrack: {
    height: 12,
    backgroundColor: '#120E0C',
    borderRadius: 999,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#3C2D24',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#E2A14A',
    borderRadius: 999,
  },
  progressSub: {
    color: '#BFA690',
    fontSize: 12,
    marginTop: 10,
  },
  sharedMetaBanner: {
    marginTop: 12,
    backgroundColor: '#17120F',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#3B2D24',
  },
  sharedMetaTitle: {
    color: '#E2A14A',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  sharedMetaText: {
    color: '#E6D6C8',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  resetLink: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingVertical: 4,
  },
  resetLinkText: {
    color: '#E2A14A',
    fontSize: 12,
    fontWeight: '800',
  },
  stepCard: {
    backgroundColor: '#211915',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1.5,
  },
  stepHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
  },
  phaseText: {
    color: '#D4AF79',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  stepTitle: {
    color: '#FFF7ED',
    fontSize: 24,
    fontWeight: '900',
    marginBottom: 6,
    maxWidth: 240,
  },
  stepDetail: {
    color: '#D2BCAB',
    fontSize: 14,
    lineHeight: 20,
    maxWidth: 270,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexShrink: 0,
    marginTop: 4,
  },
  statusDone: { backgroundColor: '#295D43' },
  statusNeedsWork: { backgroundColor: '#7D382D' },
  statusInProgress: { backgroundColor: '#5B462F' },
  statusBadgeText: {
    color: '#FFF9F0',
    fontSize: 12,
    fontWeight: '800',
  },
  stepMiniStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 14,
    marginBottom: 10,
  },
  stepMiniStat: {
    color: '#E7D5C5',
    fontSize: 13,
    fontWeight: '700',
  },
  stepMiniStatWarn: {
    color: '#D3A58A',
    fontSize: 13,
    fontWeight: '700',
  },
  checkList: {
    gap: 10,
  },
  checkCard: {
    backgroundColor: '#17120F',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#342820',
  },
  checkPromptRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  checkIndex: {
    width: 26,
    color: '#E2A14A',
    fontSize: 12,
    fontWeight: '900',
    marginTop: 2,
  },
  checkPrompt: {
    flex: 1,
    color: '#F7EFE5',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  answerRow: {
    flexDirection: 'row',
    gap: 10,
  },
  answerButton: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#4A382C',
    backgroundColor: '#251D18',
    paddingVertical: 12,
    alignItems: 'center',
  },
  answerYesActive: {
    backgroundColor: '#2E674A',
    borderColor: '#3E8A63',
  },
  answerNoActive: {
    backgroundColor: '#72352E',
    borderColor: '#A14F47',
  },
  answerText: {
    color: '#EADBCB',
    fontSize: 14,
    fontWeight: '800',
  },
  answerTextActive: {
    color: '#FFF8F0',
  },
  navRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  navButton: {
    flex: 0.9,
    backgroundColor: '#2C211A',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#46352A',
  },
  navButtonDisabled: {
    opacity: 0.45,
  },
  navButtonText: {
    color: '#F4E8DB',
    fontWeight: '800',
    fontSize: 13,
  },
  navButtonAccent: {
    flex: 1.3,
    backgroundColor: '#E2A14A',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  navButtonAccentText: {
    color: '#24160D',
    fontWeight: '900',
    fontSize: 13,
  },
  sidebarCard: {
    backgroundColor: '#201915',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#372A22',
  },
  sidebarTitle: {
    color: '#FFF7ED',
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 4,
  },
  sidebarSub: {
    color: '#C8B19D',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  sidebarEmpty: {
    color: '#AF9580',
    fontSize: 13,
  },
  upNextItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#17120F',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#30241E',
    marginBottom: 8,
  },
  upNextDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 12,
  },
  upNextBody: {
    flex: 1,
  },
  upNextPhase: {
    color: '#C8A677',
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 2,
  },
  upNextTitle: {
    color: '#F7EFE5',
    fontSize: 14,
    fontWeight: '800',
  },
  upNextArrow: {
    color: '#E2A14A',
    fontSize: 22,
    fontWeight: '700',
  },
});
