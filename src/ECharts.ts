/* eslint-disable vue/multi-word-component-names */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 1.peerDependencies 是对特定包的版本依赖，由调用方提供，避免产生依赖冲突
 * 2.vue-demi是根据vue环境提供对应能力，可以用来开发支持vue2/3的库，组件等
 * 3.假设物料是基于vue-demi开发的，下面是判断规则
 *  3.1 <=2.6: exports from vue + @vue/composition-api with plugin auto installing.
    2.7: exports from vue (Composition API is built-in in Vue 2.7).
    >=3.0: exports from vue, with polyfill of Vue 2's set and del API.
 * 4. 所以在一定场景下vue2.6,2.7是可以支持组合式api
 * 5. 将类型或接口的引入与其他的引入分开，能够更好地说明开发者的意图和意义，避免在代码中引入不必要的代码
 * 6. v-bind="$attrs" 遇到 inheritAttrs: false 需要属性透传手动绑定
 *
 */
import {
  defineComponent,
  shallowRef,
  toRefs,
  watch,
  computed,
  inject,
  onMounted,
  onBeforeUnmount,
  h,
  nextTick,
  watchEffect,
  getCurrentInstance,
  Vue2
  // type PropType,
  // type InjectionKey
} from "vue-demi";
import type { PropType, InjectionKey } from "vue-demi";
import { init as initChart } from "echarts/core";
import type {
  EChartsType,
  EventTarget,
  Option,
  Theme,
  ThemeInjection,
  InitOptions,
  InitOptionsInjection,
  UpdateOptions,
  UpdateOptionsInjection,
  Emits
} from "./types";
import {
  usePublicAPI,
  useAutoresize,
  autoresizeProps,
  useLoading,
  loadingProps
} from "./composables";
import { omitOn, unwrapInjected } from "./utils";
import { register, TAG_NAME } from "./wc";
import type { EChartsElement } from "./wc";

import "./style.css";

const wcRegistered = register();

if (Vue2) {
  Vue2.config.ignoredElements.push(TAG_NAME);
}

export const THEME_KEY = "ecTheme" as unknown as InjectionKey<ThemeInjection>;
export const INIT_OPTIONS_KEY =
  "ecInitOptions" as unknown as InjectionKey<InitOptionsInjection>;
export const UPDATE_OPTIONS_KEY =
  "ecUpdateOptions" as unknown as InjectionKey<UpdateOptionsInjection>;
export { LOADING_OPTIONS_KEY } from "./composables";

export default defineComponent({
  name: "echarts",
  // 定义输入参数
  props: {
    option: Object as PropType<Option>,
    theme: {
      type: [Object, String] as PropType<Theme>
    },
    initOptions: Object as PropType<InitOptions>,
    updateOptions: Object as PropType<UpdateOptions>,
    group: String,
    manualUpdate: Boolean,
    ...autoresizeProps,
    ...loadingProps
  },
  emits: {} as unknown as Emits,
  inheritAttrs: false,
  setup(props, { attrs }) {
    // 响应式dom
    const root = shallowRef<EChartsElement>();
    const chart = shallowRef<EChartsType>();
    const manualOption = shallowRef<Option>();
    const defaultTheme = inject(THEME_KEY, null);
    const defaultInitOptions = inject(INIT_OPTIONS_KEY, null);
    const defaultUpdateOptions = inject(UPDATE_OPTIONS_KEY, null);

    const { autoresize, manualUpdate, loading, loadingOptions } = toRefs(props);

    const realOption = computed(
      () => manualOption.value || props.option || null
    );
    const realTheme = computed(
      () => props.theme || unwrapInjected(defaultTheme, {})
    );
    const realInitOptions = computed(
      () => props.initOptions || unwrapInjected(defaultInitOptions, {})
    );
    const realUpdateOptions = computed(
      () => props.updateOptions || unwrapInjected(defaultUpdateOptions, {})
    );
    const nonEventAttrs = computed(() => omitOn(attrs));

    // @ts-expect-error listeners for Vue 2 compatibility
    const listeners = getCurrentInstance().proxy.$listeners;

    function init(option?: Option) {
      if (!root.value) {
        return;
      }
      /**
       * init 方法见函数签名：dom|theme|options
       * 处理初始化操作
       *
       */
      const instance = (chart.value = initChart(
        root.value,
        realTheme.value,
        realInitOptions.value
      ));
      // 设置分组属性
      if (props.group) {
        instance.group = props.group;
      }

      let realListeners = listeners;
      if (!realListeners) {
        realListeners = {};

        Object.keys(attrs)
          .filter(key => key.indexOf("on") === 0 && key.length > 2)
          .forEach(key => {
            // onClick    -> c + lick
            // onZr:click -> z + r:click
            let event = key.charAt(2).toLowerCase() + key.slice(3);

            // clickOnce    -> ~click
            // zr:clickOnce -> ~zr:click
            if (event.substring(event.length - 4) === "Once") {
              event = `~${event.substring(0, event.length - 4)}`;
            }

            realListeners[event] = attrs[key];
          });
      }
      // 绑定事件处理
      Object.keys(realListeners).forEach(key => {
        let handler = realListeners[key];

        if (!handler) {
          return;
        }

        let event = key.toLowerCase();
        if (event.charAt(0) === "~") {
          event = event.substring(1);
          handler.__once__ = true;
        }

        let target: EventTarget = instance;
        if (event.indexOf("zr:") === 0) {
          target = instance.getZr();
          event = event.substring(3);
        }

        if (handler.__once__) {
          delete handler.__once__;

          const raw = handler;

          handler = (...args: any[]) => {
            raw(...args);
            target.off(event, handler);
          };
        }

        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore EChartsType["on"] is not compatible with ZRenderType["on"]
        // but it's okay here
        target.on(event, handler);
      });

      function resize() {
        if (instance && !instance.isDisposed()) {
          instance.resize();
        }
      }

      function commit() {
        const opt = option || realOption.value;
        if (opt) {
          instance.setOption(opt, realUpdateOptions.value);
        }
      }

      if (autoresize.value) {
        // Try to make chart fit to container in case container size
        // is changed synchronously or in already queued microtasks
        nextTick(() => {
          resize();
          commit();
        });
      } else {
        commit();
      }
    }

    function setOption(option: Option, updateOptions?: UpdateOptions) {
      if (props.manualUpdate) {
        manualOption.value = option;
      }

      if (!chart.value) {
        init(option);
      } else {
        chart.value.setOption(option, updateOptions || {});
      }
    }

    function cleanup() {
      if (chart.value) {
        chart.value.dispose();
        chart.value = undefined;
      }
    }

    let unwatchOption: (() => void) | null = null;
    watch(
      manualUpdate,
      manualUpdate => {
        if (typeof unwatchOption === "function") {
          unwatchOption();
          unwatchOption = null;
        }

        if (!manualUpdate) {
          unwatchOption = watch(
            () => props.option,
            (option, oldOption) => {
              if (!option) {
                return;
              }
              if (!chart.value) {
                init();
              } else {
                chart.value.setOption(option, {
                  // mutating `option` will lead to `notMerge: false` and
                  // replacing it with new reference will lead to `notMerge: true`
                  notMerge: option !== oldOption,
                  ...realUpdateOptions.value
                });
              }
            },
            { deep: true }
          );
        }
      },
      {
        immediate: true
      }
    );

    watch(
      [realTheme, realInitOptions],
      () => {
        cleanup();
        init();
      },
      {
        deep: true
      }
    );

    watchEffect(() => {
      if (props.group && chart.value) {
        chart.value.group = props.group;
      }
    });

    const publicApi = usePublicAPI(chart);

    useLoading(chart, loading, loadingOptions);

    useAutoresize(chart, autoresize, root);

    onMounted(() => {
      init();
    });

    onBeforeUnmount(() => {
      if (wcRegistered && root.value) {
        // For registered web component, we can leverage the
        // `disconnectedCallback` to dispose the chart instance
        // so that we can delay the cleanup after exsiting leaving
        // transition.
        root.value.__dispose = cleanup;
      } else {
        cleanup();
      }
    });

    return {
      chart,
      root,
      setOption,
      nonEventAttrs,
      ...publicApi
    };
  },
  render() {
    // Vue 3 and Vue 2 have different vnode props format:
    // See https://v3-migration.vuejs.org/breaking-changes/render-function-api.html#vnode-props-format
    const attrs = (
      Vue2 ? { attrs: this.nonEventAttrs } : { ...this.nonEventAttrs }
    ) as any;
    attrs.ref = "root";
    attrs.class = attrs.class ? ["echarts"].concat(attrs.class) : "echarts";
    return h(TAG_NAME, attrs);
  }
});
