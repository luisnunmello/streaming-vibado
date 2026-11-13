import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DialogHost } from './shared/dialog-host';
import { ToastHost } from './shared/toast-host';

@Component({
  imports: [RouterOutlet, DialogHost, ToastHost],
  selector: 'app-root',
  template: '<router-outlet /><app-dialog-host /><app-toast-host />',
})
export class App {}
