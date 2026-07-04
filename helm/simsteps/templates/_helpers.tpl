{{/* Nom court du chart */}}
{{- define "simsteps.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Nom complet des ressources (release + chart) */}}
{{- define "simsteps.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/* Étiquettes communes */}}
{{- define "simsteps.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{ include "simsteps.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/* Étiquettes de sélection */}}
{{- define "simsteps.selectorLabels" -}}
app.kubernetes.io/name: {{ include "simsteps.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Nom du Secret contenant DATABASE_URL : secret existant fourni par
l'utilisateur, sinon secret géré par le chart.
*/}}
{{- define "simsteps.secretName" -}}
{{- if .Values.database.existingSecret }}
{{- .Values.database.existingSecret }}
{{- else }}
{{- include "simsteps.fullname" . }}
{{- end }}
{{- end }}

{{/*
URL de connexion PostgreSQL :
- sous-chart Bitnami activé → URL vers son Service ;
- sinon database.externalUrl (obligatoire dans ce cas, sauf si un
  Secret existant est fourni).
*/}}
{{- define "simsteps.databaseUrl" -}}
{{- if .Values.postgresql.enabled -}}
postgres://{{ .Values.postgresql.auth.username }}:{{ .Values.postgresql.auth.password }}@{{ .Release.Name }}-postgresql:5432/{{ .Values.postgresql.auth.database }}
{{- else -}}
{{- required "database.externalUrl est requis quand postgresql.enabled=false (ou fournissez database.existingSecret)" .Values.database.externalUrl -}}
{{- end -}}
{{- end }}
