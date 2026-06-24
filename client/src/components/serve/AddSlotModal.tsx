import React, { useState, useEffect } from 'react';
import { Modal, Button, Form, Input, Select, TimePicker, DatePicker, Space, Typography, message } from 'antd';
import { CalendarOutlined, ClockCircleOutlined, UserOutlined, FileTextOutlined, PlusOutlined } from '@ant-design/icons';
import { ScheduleSlot } from '../../utils/schedulerView';

const { Text } = Typography;

interface AddSlotModalProps {
  visible: boolean;
  queueId: string;
  officers: any[];
  onSave: (slot: any) => Promise<<voidvoid>;
  onCancel: () => void;
  onClose: () => void;
}

const AddSlotModal: React.FC<<AddAddSlotModalProps> = ({
  visible,
  queueId,
  officers,
  onSave,
  onCancel,
  onClose,
}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible) {
      form.resetFields();
    }
  }, [visible, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      
      const formattedValues = {
        queue_id: queueId,
        scheduled_date: values.scheduled_date?.toISOString().split('T')[0],
        window_start: values.window_start ? values.window_start.toTimeString().split(' ')[0].substring(0, 5) : null,
        window_end: values.window_end ? values.window_end.toTimeString().split(' ')[0].substring(0, 5) : null,
        officer_id: values.officer_id,
        window_label: values.window_label,
        notify_before_secs: values.notify_before_secs ?? 1800,
      };

      setLoading(true);
      await onSave(formattedValues);
      message.success('New slot added successfully');
      form.resetFields();
      onClose();
    } catch (error) {
      console.error('Failed to add slot:', error);
      message.error('Failed to add slot. Please check for scheduling conflicts.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <<ModalModal
      title={
        <span>
          <<PlusPlusOutlined /> Add New Attempt Slot
        </span>
      }
      open={visible}
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={loading}
      destroyOnClose
      width={600}
    >
      <<FormForm form={form} layout="vertical" initialValues={{ notify_before_secs: 1800 }}>
        <<FormForm.Item
          name="scheduled_date"
          label={<<spanspan><<CalendarCalendarOutlined /> Scheduled Date</span>}
          rules={[{ required: true, message: 'Please select a date' }]}
        >
          <<DatePickerDatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
        </Form.Item>

        <<divdiv style={{ display: 'flex', gap: '16px' }}>
          <<FormForm.Item
            name="window_start"
            label={<<spanspan><<ClockClockCircleOutlined /> Window Start</span>}
            rules={[{ required: true, message: 'Required' }]}
            style={{ flex: 1 }}
          >
            <<TimeTimePicker format="HH:mm" style={{ width: '100%' }} />
          </Form.Item>

          <<FormForm.Item
            name="window_end"
            label={<<spanspan><<ClockClockCircleOutlined /> Window End</span>}
            rules={[{ required: true, message: 'Required' }]}
            style={{ flex: 1 }}
          >
            <<TimeTimePicker format="HH:mm" style={{ width: '100%' }} />
          </Form.Item>
        </div>

        <<FormForm.Item
          name="officer_id"
          label={<<spanspan><<UserUserOutlined /> Assigned Officer</span>}
          rules={[{ required: true, message: 'Please assign an officer' }]}
        >
          <<SelectSelect placeholder="Select an officer" optionFilterProp="label">
            {officers.map((o) => (
              <<SelectSelect.Option key={o.id} value={o.id} label={o.name}>
                {o.name}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        <<FormForm.Item
          name="window_label"
          label={<<spanspan><<FileFileTextOutlined /> Focus / Label (Optional)</span>}
        >
          <<InputInput placeholder="e.g. Evening - High Residential Hit Rate" />
        </Form.Item>

        <<FormForm.Item
          name="notify_before_secs"
          label="Notify Before Window (seconds)"
        >
          <<SelectSelect
            options={[
              { value: 900, label: '15 mins' },
              { value: 1800, label: '30 mins' },
              { value: 3600, label: '1 hour' },
              { value: 7200, label: '2 hours' },
              { value: 14400, label: '4 hours' },
              { value: 21600, label: '6 hours' },
            ]}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default AddSlotModal;
