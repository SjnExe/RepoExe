step_install_service_scripts() {
	array_length=${#PKG_SERVICE_SCRIPT[@]}
	if [ $array_length -eq 0 ]; then return; fi

	# PKG_SERVICE_SCRIPT should have the structure =("daemon name" 'script to execute')
	if [ $(( $array_length & 1 )) -eq 1 ]; then
		error_exit "PKG_SERVICE_SCRIPT has to be an array of even length"
	fi

	mkdir -p $PREFIX/var/service
	cd $PREFIX/var/service
	for ((i=0; i<${array_length}; i+=2)); do
		mkdir -p ${PKG_SERVICE_SCRIPT[$i]}
		# We unlink ${PKG_SERVICE_SCRIPT[$i]}/run if it exists to
		# allow it to be overwritten through PKG_SERVICE_SCRIPT
		if [ -L "${PKG_SERVICE_SCRIPT[$i]}/run" ]; then
			unlink "${PKG_SERVICE_SCRIPT[$i]}/run"
		fi
		echo "#!$PREFIX/bin/sh" > ${PKG_SERVICE_SCRIPT[$i]}/run
		echo -e ${PKG_SERVICE_SCRIPT[$((i + 1))]} >> ${PKG_SERVICE_SCRIPT[$i]}/run

		# Do not add service script to CONFFILES if it already exists there
		if [[ $PKG_CONFFILES != *${PKG_SERVICE_SCRIPT[$i]}/run* ]]; then
			PKG_CONFFILES+=" var/service/${PKG_SERVICE_SCRIPT[$i]}/run"
		fi

		chmod +x ${PKG_SERVICE_SCRIPT[$i]}/run

		# Avoid creating service/<service>/log/log/
		if [ "${PKG_SERVICE_SCRIPT[$i]: -4}" != "/log" ]; then
			touch ${PKG_SERVICE_SCRIPT[$i]}/down
			PKG_CONFFILES+=" var/service/${PKG_SERVICE_SCRIPT[$i]}/down"
			local _log_run=${PKG_SERVICE_SCRIPT[$i]}/log/run
			rm -rf "${_log_run}"
			mkdir -p "$(dirname "${_log_run}")"
			cat <<-EOF > "${_log_run}"
				#!$PREFIX/bin/sh
				svlogger="$PREFIX/share/repoexe-services/svlogger"
				exec "\${svlogger}" "\$@"
			EOF
			chmod 0700 "${_log_run}"

			PKG_CONFFILES+="
			var/service/${PKG_SERVICE_SCRIPT[$i]}/log/run
			var/service/${PKG_SERVICE_SCRIPT[$i]}/log/down
			"
		fi
	done
}
