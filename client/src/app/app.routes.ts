import { Routes } from '@angular/router';
import { adminGuard, authGuard, guestGuard } from './core/guards';
import { Activate } from './pages/activate';
import { Account } from './pages/dashboard/account';
import { Bandwidth } from './pages/dashboard/bandwidth';
import { Guests } from './pages/dashboard/guests';
import { Referrals } from './pages/dashboard/referrals';
import { Rooms } from './pages/dashboard/rooms';
import { Shell } from './pages/dashboard/shell';
import { Studio } from './pages/dashboard/studio';
import { Home } from './pages/home';
import { Lobbies } from './pages/lobbies';
import { Login } from './pages/login';
import { Viewer } from './viewer/viewer';

export const routes: Routes = [
  { path: '', component: Home, title: 'Streaming' },
  { path: 'lobbies', component: Lobbies, title: 'Public rooms' },
  { path: 'r/:slug', component: Viewer, title: 'Live stream' },
  { path: 'login', component: Login, title: 'Sign in' },
  { path: 'activate', component: Activate, title: 'Activate account' },
  {
    path: 'dashboard',
    component: Shell,
    canActivate: [authGuard],
    title: 'Dashboard',
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'rooms' },
      { path: 'rooms', component: Rooms },
      { path: 'rooms/:slug', component: Studio },
      { path: 'referrals', component: Referrals, canActivate: [guestGuard] },
      { path: 'account', component: Account },
      { path: 'guests', component: Guests, canActivate: [adminGuard] },
      { path: 'bandwidth', component: Bandwidth, canActivate: [adminGuard] },
    ],
  },
  { path: 'admin', redirectTo: 'dashboard' },
  { path: '**', redirectTo: '' },
];
