import { Routes } from '@angular/router';
import { adminGuard, authGuard, loadAuthGuard, userGuard } from './core/guards';
import { Activate } from './pages/activate';
import { Account } from './pages/dashboard/account';
import { Bandwidth } from './pages/dashboard/bandwidth';
import { Users } from './pages/dashboard/users';
import { Referrals } from './pages/dashboard/referrals';
import { Presets } from './pages/dashboard/presets';
import { Rooms } from './pages/dashboard/rooms';
import { Shell } from './pages/dashboard/shell';
import { Studio } from './pages/dashboard/studio';
import { Invite } from './pages/invite';
import { Invites } from './pages/dashboard/invites';
import { Login } from './pages/login';
import { Viewer } from './viewer/viewer';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard/rooms' },
  { path: 'lobbies', redirectTo: 'dashboard/rooms' },
  { path: 'r/:slug', component: Viewer, title: 'Live stream' },
  { path: 'login', component: Login, title: 'Sign in' },
  { path: 'activate', component: Activate, title: 'Activate account' },
  { path: 'invite', component: Invite, title: 'Temporary invite' },
  {
    path: 'dashboard',
    component: Shell,
    canActivate: [loadAuthGuard],
    title: 'Dashboard',
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'rooms' },
      { path: 'rooms', component: Rooms },
      { path: 'rooms/:slug', component: Studio, canActivate: [authGuard] },
      { path: 'referrals', component: Referrals, canActivate: [userGuard] },
      { path: 'account', component: Account, canActivate: [authGuard] },
      { path: 'invites', component: Invites, canActivate: [authGuard] },
      { path: 'users', component: Users, canActivate: [adminGuard] },
      { path: 'presets', component: Presets, canActivate: [adminGuard] },
      { path: 'bandwidth', component: Bandwidth, canActivate: [adminGuard] },
    ],
  },
  { path: 'admin', redirectTo: 'dashboard' },
  { path: '**', redirectTo: '' },
];
