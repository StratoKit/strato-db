import {unknown, DEV} from '../lib/warning'
import {settleAll} from '../lib/settleAll'

const applyResult = async (model, result) => {
	const {rm, set, ins, upd, sav} = result
	if (DEV) {
		// eslint-disable-next-line no-shadow
		const {rm, set, ins, upd, sav, ...rest} = result
		for (const k of Object.keys(rest))
			if (typeof rest[k] !== 'undefined') unknown(k, `key ${k} in result`)
	}
	if (rm) await settleAll(rm, item => model.remove(item))
	if (ins) await settleAll(ins, obj => model.set(obj, true, true))
	if (set) await settleAll(set, obj => model.set(obj, false, true))
	if (upd) await settleAll(upd, obj => model.updateNoTrans(obj, true, true))
	if (sav) await settleAll(sav, obj => model.updateNoTrans(obj, false, true))
}

export default applyResult
